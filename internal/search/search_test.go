package search

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParse(t *testing.T) {
	cases := []struct {
		input string
		want  []Term
	}{
		{`route:/checkout`, []Term{{Field: "route", Operator: OpEquals, Values: []string{"/checkout"}}}},
		{`!route:/checkout`, []Term{{Field: "route", Negated: true, Operator: OpEquals, Values: []string{"/checkout"}}}},
		{`browser:[Chrome, "Mobile Safari"]`, []Term{{Field: "browser", Operator: OpIn, Values: []string{"Chrome", "Mobile Safari"}}}},
		{`!browser:[Chrome]`, []Term{{Field: "browser", Negated: true, Operator: OpIn, Values: []string{"Chrome"}}}},
		{`route:*checkout*`, []Term{{Field: "route", Operator: OpContains, Values: []string{"checkout"}}}},
		{`route:/api/*`, []Term{{Field: "route", Operator: OpPrefix, Values: []string{"/api/"}}}},
		{`route:*.js`, []Term{{Field: "route", Operator: OpSuffix, Values: []string{".js"}}}},
		{`route:"*literal*"`, []Term{{Field: "route", Operator: OpEquals, Values: []string{"*literal*"}}}},
		{`has:trace_id`, []Term{{Field: "trace_id", Operator: OpHas}}},
		{`!has:attributes.plan`, []Term{{Field: "attributes.plan", Negated: true, Operator: OpHas}}},
		{`trace_id:*`, []Term{{Field: "trace_id", Operator: OpHas}}},
		{`status:>=500 duration:<2s`, []Term{
			{Field: "status", Operator: OpGTE, Values: []string{"500"}},
			{Field: "duration", Operator: OpLT, Values: []string{"2s"}},
		}},
		{`timeout "network error" !retry`, []Term{
			{Operator: OpContains, Values: []string{"timeout"}},
			{Operator: OpContains, Values: []string{"network error"}},
			{Negated: true, Operator: OpContains, Values: []string{"retry"}},
		}},
		{`message:"a b"`, []Term{{Field: "message", Operator: OpEquals, Values: []string{"a b"}}}},
		{`https://example.com/a`, []Term{{Operator: OpContains, Values: []string{"https://example.com/a"}}}},
		{``, []Term{}},
		{`route:/a AND !browser:Chrome`, []Term{
			{Field: "route", Operator: OpEquals, Values: []string{"/a"}},
			{Field: "browser", Negated: true, Operator: OpEquals, Values: []string{"Chrome"}},
		}},
	}
	for _, testCase := range cases {
		got, err := Parse(testCase.input)
		if err != nil {
			t.Fatalf("%q: %v", testCase.input, err)
		}
		for index := range got {
			got[index].Position, got[index].Raw = 0, ""
		}
		if !reflect.DeepEqual(got, testCase.want) {
			t.Errorf("%q:\n got  %+v\n want %+v", testCase.input, got, testCase.want)
		}
	}
}

func TestParseRefusesWithAPosition(t *testing.T) {
	for input, code := range map[string]string{
		`route:"open`:                    CodeUnterminated,
		`a OR b`:                         CodeBooleanKeyword,
		`NOT a`:                          CodeBooleanKeyword,
		`route:`:                         CodeEmptyValue,
		`route:a*b`:                      CodeWildcardPosition,
		`route:**`:                       CodeWildcardPosition,
		`browser:[a,b`:                   CodeInvalidValue,
		`browser:[]`:                     CodeEmptyValue,
		strings.Repeat("a ", 13):         CodeTooManyTerms,
		strings.Repeat("a", MaxLength+1): CodeTooLong,
	} {
		_, err := Parse(input)
		var searchError *Error
		if !errors.As(err, &searchError) || searchError.Code != code || !errors.Is(err, ErrInvalid) {
			t.Errorf("%q: err=%v, want %s", input, err, code)
		}
	}
	_, err := Parse(`level:error route:"open`)
	var searchError *Error
	if !errors.As(err, &searchError) || searchError.Position != 12 {
		t.Fatalf("position err=%v", err)
	}
}

var testSchema = Schema{
	Fields: []Field{
		{Key: "route", Exprs: []string{"route"}, Aggregate: "route", Type: Text},
		{Key: "browser", Exprs: []string{"browser"}, Aggregate: "browser", Type: Enum},
		{Key: "level", Exprs: []string{"log_level"}, Type: Enum, Normalize: func(value string) (string, bool) {
			value = strings.ToLower(value)
			return value, value == "info" || value == "error"
		}},
		{Key: "session_id", Exprs: []string{"session_id"}, Type: UUID},
		{Key: "status", Exprs: []string{"api_status"}, Type: Number},
		{Key: "duration", Exprs: []string{"duration_seconds"}, Type: Duration, DurationUnit: time.Second, Scope: Having},
		{Key: "visited", Aliases: []string{"page"}, Exprs: []string{"route"}, Type: Text, Scope: AnyEvent},
		{Key: "title", Exprs: []string{"error_message"}, Aggregate: "issue_title", AggregateHaving: true, Type: Text},
		{Key: "search", Exprs: []string{"route", "user_id"}, Type: Text},
	},
	AttributeExpr: "attributes",
	FreeText:      "title",
}

func TestCompileBindsEveryValue(t *testing.T) {
	cases := []struct {
		input, where, having string
		args                 []any
	}{
		{`route:/a`, " AND (route = ?)", "", []any{"/a"}},
		{`!browser:[Chrome,Safari]`, " AND NOT (browser IN (?,?))", "", []any{"Chrome", "Safari"}},
		{`route:*pay*`, " AND (positionCaseInsensitiveUTF8(route, ?) > 0)", "", []any{"pay"}},
		{`!has:route`, " AND NOT (route != '')", "", nil},
		{`has:session_id`, " AND (session_id != toUUID('00000000-0000-0000-0000-000000000000'))", "", nil},
		{`status:>=500`, " AND (api_status >= ?)", "", []any{500.0}},
		{`duration:>2m`, "", " AND (duration_seconds > ?)", []any{120.0}},
		{`page:/checkout`, "", " AND countIf(route = ?) > 0", []any{"/checkout"}},
		{`!visited:/checkout`, "", " AND countIf(route = ?) = 0", []any{"/checkout"}},
		{`attributes.plan:pro`, " AND (attributes[?] = ?)", "", []any{"plan", "pro"}},
		{`has:attributes.plan`, " AND (mapContains(attributes, ?))", "", []any{"plan"}},
		{`search:*42*`, " AND (positionCaseInsensitiveUTF8(route, ?) > 0 OR positionCaseInsensitiveUTF8(user_id, ?) > 0)", "", []any{"42", "42"}},
		{`level:ERROR`, " AND (log_level = ?)", "", []any{"error"}},
		{`checkout`, " AND (positionCaseInsensitiveUTF8(error_message, ?) > 0)", "", []any{"checkout"}},
	}
	for _, testCase := range cases {
		compiled, _, err := testSchema.ParseAndCompile(testCase.input, Raw)
		if err != nil {
			t.Fatalf("%q: %v", testCase.input, err)
		}
		where, whereArgs := compiled.WhereSQL()
		having, havingArgs := compiled.HavingSQL()
		args := append(whereArgs, havingArgs...)
		if where != testCase.where || having != testCase.having || !reflect.DeepEqual(args, testCase.args) {
			t.Errorf("%q:\n got  where=%q having=%q args=%v\n want where=%q having=%q args=%v",
				testCase.input, where, having, args, testCase.where, testCase.having, testCase.args)
		}
	}
}

// A value never reaches the SQL text, whatever it contains.
func TestCompileNeverInlinesValues(t *testing.T) {
	hostile := `route:"x') OR 1=1 --" attributes.plan:"'; DROP TABLE rum_events" "') OR ('1'='1"`
	compiled, _, err := testSchema.ParseAndCompile(hostile, Raw)
	if err != nil {
		t.Fatal(err)
	}
	where, _ := compiled.WhereSQL()
	having, _ := compiled.HavingSQL()
	for _, fragment := range []string{"1=1", "DROP", "'1'"} {
		if strings.Contains(where+having, fragment) {
			t.Fatalf("value inlined into SQL: %s %s", where, having)
		}
	}
}

func TestCompileRefusesWhatTheFieldCannotDo(t *testing.T) {
	for input, code := range map[string]string{
		`nope:1`:              CodeUnknownField,
		`browser:*Chr*`:       CodeUnsupported,
		`status:*5*`:          CodeUnsupported,
		`route:>3`:            CodeUnsupported,
		`status:abc`:          CodeInvalidValue,
		`duration:>soon`:      CodeInvalidValue,
		`session_id:not-uuid`: CodeInvalidValue,
		`level:verbose`:       CodeInvalidValue,
		`search:>1`:           CodeUnsupported,
	} {
		_, _, err := testSchema.ParseAndCompile(input, Raw)
		var searchError *Error
		if !errors.As(err, &searchError) || searchError.Code != code {
			t.Errorf("%q: err=%v, want %s", input, err, code)
		}
	}
	noFreeText := testSchema
	noFreeText.FreeText = ""
	if _, _, err := noFreeText.ParseAndCompile("word", Raw); err == nil {
		t.Fatal("free text accepted by a page without it")
	}
	noAttributes := testSchema
	noAttributes.AttributeExpr = ""
	if _, _, err := noAttributes.ParseAndCompile("attributes.plan:pro", Raw); err == nil {
		t.Fatal("attribute accepted by a page without them")
	}
}

func TestAggregateModeLeavesOutRawOnlyTerms(t *testing.T) {
	terms, err := Parse(`route:/a status:>=500 title:*boom*`)
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := testSchema.Compile(terms, Aggregate)
	if err != nil {
		t.Fatal(err)
	}
	where, _ := compiled.WhereSQL()
	having, _ := compiled.HavingSQL()
	if !compiled.RawOnly || where != " AND (route = ?)" || having != " AND (positionCaseInsensitiveUTF8(issue_title, ?) > 0)" {
		t.Fatalf("rawOnly=%v where=%q having=%q", compiled.RawOnly, where, having)
	}
	if testSchema.NeedsRaw(terms[:1]) || !testSchema.NeedsRaw(terms) {
		t.Fatal("NeedsRaw is wrong")
	}
}
