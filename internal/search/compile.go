package search

import (
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Type decides which operators a field accepts and how its values are read.
type Type int

const (
	// Text is free-form: every string operator, including contains, prefix and suffix.
	Text Type = iota
	// Enum is a short set of known values: equals, one of, and has.
	Enum
	// UUID is an identifier: equals, one of, and has; values must parse.
	UUID
	// Number compares with > >= < <= as well as equals and one of.
	Number
	// Duration is a Number whose values may carry a unit: 250ms, 2s, 1.5m, 1h.
	Duration
)

// Scope says where a raw-table condition goes in a grouped query.
type Scope int

const (
	// Where filters rows.
	Where Scope = iota
	// AnyEvent keeps a group when any of its rows matches (countIf(...)>0), and a negated
	// term keeps a group when none does. Sessions use it, so "visited /checkout" means one
	// page of the session, not every page.
	AnyEvent
	// Having compares a value the query computes per group, such as a session's duration.
	Having
)

// Mode picks the table a query reads.
type Mode int

const (
	Raw Mode = iota
	Aggregate
)

// Field is one searchable name. Every expression is fixed in code.
type Field struct {
	Key     string
	Aliases []string
	// Exprs is the raw-table expression. More than one means "any of these columns", for a
	// free-text field that looks in several places; only string operators then apply.
	Exprs []string
	// Aggregate is the expression on the page's aggregate table, empty when it does not keep
	// this field. AggregateHaving puts it after GROUP BY, for values merged from states.
	Aggregate       string
	AggregateHaving bool
	Type            Type
	Scope           Scope
	// DurationUnit is what a Duration field stores; values are converted to it.
	DurationUnit time.Duration
	// Normalize canonicalizes and checks one value; false refuses it.
	Normalize func(string) (string, bool)
	// CaseSensitive matches text exactly, as log messages always have.
	CaseSensitive bool
	// EqualsMeansContains keeps message:x meaning "the message contains x".
	EqualsMeansContains bool
}

// Schema is what one page lets people search.
type Schema struct {
	Fields []Field
	// AttributeExpr is the Map column attributes.<key> reads; empty turns attributes off.
	AttributeExpr string
	// AttributeScope places attribute conditions, as Field.Scope does.
	AttributeScope Scope
	// UnknownFieldsAreAttributes keeps the logs rule that any other name is an attribute.
	UnknownFieldsAreAttributes bool
	// FreeText names the field a bare word searches; empty means the page has none.
	FreeText string
	// AttributeKey checks an attribute name.
	AttributeKey func(string) bool
}

// Clause is one condition with its bound values.
type Clause struct {
	SQL  string
	Args []any
}

// Compiled is a search turned into conditions.
type Compiled struct {
	Where  []Clause
	Having []Clause
	// RawOnly is true when a term needs the raw table. In Aggregate mode such terms are left
	// out, so a caller that must honour them reads the raw table instead.
	RawOnly bool
}

// WhereSQL returns " AND a AND b" (or "") and its arguments.
func (compiled Compiled) WhereSQL() (string, []any) { return join(compiled.Where) }

// HavingSQL returns " AND a AND b" (or "") and its arguments.
func (compiled Compiled) HavingSQL() (string, []any) { return join(compiled.Having) }

func join(clauses []Clause) (string, []any) {
	var builder strings.Builder
	var args []any
	for _, clause := range clauses {
		builder.WriteString(" AND ")
		builder.WriteString(clause.SQL)
		args = append(args, clause.Args...)
	}
	return builder.String(), args
}

const nilUUID = "toUUID('00000000-0000-0000-0000-000000000000')"

// Lookup finds a field by key or alias.
func (schema Schema) Lookup(name string) (Field, bool) {
	for _, field := range schema.Fields {
		if field.Key == name {
			return field, true
		}
		for _, alias := range field.Aliases {
			if alias == name {
				return field, true
			}
		}
	}
	return Field{}, false
}

// NeedsRaw reports whether any term names a field the aggregate table does not keep.
func (schema Schema) NeedsRaw(terms []Term) bool {
	compiled, err := schema.Compile(terms, Aggregate)
	return err == nil && compiled.RawOnly
}

// ParseAndCompile is Parse followed by Compile.
func (schema Schema) ParseAndCompile(input string, mode Mode) (Compiled, []Term, error) {
	terms, err := Parse(input)
	if err != nil {
		return Compiled{}, nil, err
	}
	compiled, err := schema.Compile(terms, mode)
	return compiled, terms, err
}

// Compile checks every term against the schema and builds its condition.
func (schema Schema) Compile(terms []Term, mode Mode) (Compiled, error) {
	var compiled Compiled
	for _, term := range terms {
		fail := func(code string) (Compiled, error) {
			return Compiled{}, &Error{Code: code, Position: term.Position, Term: term.Raw}
		}
		var field Field
		var exprArgs []any
		attribute := false
		switch term.Field {
		case "":
			if schema.FreeText == "" {
				return fail(CodeNoFreeText)
			}
			field, _ = schema.Lookup(schema.FreeText)
		default:
			if found, ok := schema.Lookup(term.Field); ok {
				field = found
				break
			}
			key, isAttribute := strings.CutPrefix(term.Field, "attributes.")
			if !isAttribute && schema.UnknownFieldsAreAttributes {
				key, isAttribute = term.Field, true
			}
			if !isAttribute || schema.AttributeExpr == "" || (schema.AttributeKey != nil && !schema.AttributeKey(key)) {
				return fail(CodeUnknownField)
			}
			attribute = true
			field = Field{Key: term.Field, Exprs: []string{schema.AttributeExpr + "[?]"}, Type: Text, Scope: schema.AttributeScope}
			exprArgs = []any{key}
		}
		placement := field.Scope
		exprs := field.Exprs
		if mode == Aggregate {
			if field.Aggregate == "" {
				compiled.RawOnly = true
				continue
			}
			exprs, placement = []string{field.Aggregate}, Where
			if field.AggregateHaving {
				placement = Having
			}
		}
		operator := term.Operator
		if operator == OpEquals && field.EqualsMeansContains {
			operator = OpContains
		}
		if !allowed(field.Type, operator, len(exprs)) {
			return fail(CodeUnsupported)
		}
		values := make([]any, 0, len(term.Values))
		for _, raw := range term.Values {
			value, ok := convert(field, raw)
			if !ok {
				return fail(CodeInvalidValue)
			}
			values = append(values, value)
		}
		condition, args := condition(field, exprs, exprArgs, operator, values, attribute, schema.AttributeExpr)
		negated := term.Negated
		switch placement {
		case AnyEvent:
			comparison := " > 0"
			if negated {
				comparison = " = 0"
			}
			compiled.Having = append(compiled.Having, Clause{SQL: "countIf(" + condition + ")" + comparison, Args: args})
		case Having:
			compiled.Having = append(compiled.Having, Clause{SQL: negate(condition, negated), Args: args})
		default:
			compiled.Where = append(compiled.Where, Clause{SQL: negate(condition, negated), Args: args})
		}
	}
	return compiled, nil
}

func negate(condition string, negated bool) string {
	if negated {
		return "NOT (" + condition + ")"
	}
	return "(" + condition + ")"
}

func allowed(fieldType Type, operator Operator, exprs int) bool {
	text := operator == OpEquals || operator == OpIn || operator == OpContains || operator == OpPrefix ||
		operator == OpSuffix || operator == OpHas
	comparison := operator == OpGT || operator == OpGTE || operator == OpLT || operator == OpLTE
	if exprs > 1 {
		return fieldType == Text && text
	}
	switch fieldType {
	case Text:
		return text
	case Enum, UUID:
		return operator == OpEquals || operator == OpIn || operator == OpHas
	case Number, Duration:
		return operator == OpEquals || operator == OpIn || comparison
	}
	return false
}

func convert(field Field, raw string) (any, bool) {
	if strings.ContainsAny(raw, "\x00") || len(raw) > 512 {
		return nil, false
	}
	value := raw
	if field.Normalize != nil {
		normalized, ok := field.Normalize(value)
		if !ok {
			return nil, false
		}
		value = normalized
	}
	switch field.Type {
	case UUID:
		parsed, err := uuid.Parse(value)
		if err != nil {
			return nil, false
		}
		return parsed, true
	case Number:
		number, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return nil, false
		}
		return number, true
	case Duration:
		return parseDuration(value, field.DurationUnit)
	}
	return value, true
}

// parseDuration reads 250ms, 2s, 1.5m or 1h; a bare number is in the field's own unit.
func parseDuration(value string, unit time.Duration) (any, bool) {
	if unit <= 0 {
		unit = time.Millisecond
	}
	for _, suffix := range []struct {
		text string
		unit time.Duration
	}{{"ms", time.Millisecond}, {"s", time.Second}, {"m", time.Minute}, {"h", time.Hour}} {
		if number, ok := strings.CutSuffix(value, suffix.text); ok {
			parsed, err := strconv.ParseFloat(number, 64)
			if err != nil || parsed < 0 {
				return nil, false
			}
			return parsed * float64(suffix.unit) / float64(unit), true
		}
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed < 0 {
		return nil, false
	}
	return parsed, true
}

// condition builds the positive form; the caller negates it.
func condition(field Field, exprs []string, exprArgs []any, operator Operator, values []any, attribute bool, attributeExpr string) (string, []any) {
	contains := "positionCaseInsensitiveUTF8"
	if field.CaseSensitive {
		contains = "position"
	}
	one := func(expr string) (string, []any) {
		args := append([]any(nil), exprArgs...)
		switch operator {
		case OpEquals:
			return expr + " = ?", append(args, values[0])
		case OpIn:
			return expr + " IN (" + strings.TrimSuffix(strings.Repeat("?,", len(values)), ",") + ")", append(args, values...)
		case OpContains:
			return contains + "(" + expr + ", ?) > 0", append(args, values[0])
		case OpPrefix:
			return "startsWith(" + expr + ", ?)", append(args, values[0])
		case OpSuffix:
			return "endsWith(" + expr + ", ?)", append(args, values[0])
		case OpGT:
			return expr + " > ?", append(args, values[0])
		case OpGTE:
			return expr + " >= ?", append(args, values[0])
		case OpLT:
			return expr + " < ?", append(args, values[0])
		case OpLTE:
			return expr + " <= ?", append(args, values[0])
		case OpHas:
			if attribute {
				return "mapContains(" + attributeExpr + ", ?)", args
			}
			if field.Type == UUID {
				return expr + " != " + nilUUID, args
			}
			return expr + " != ''", args
		}
		return "0", args
	}
	if len(exprs) == 1 {
		return one(exprs[0])
	}
	parts := make([]string, 0, len(exprs))
	var args []any
	for _, expr := range exprs {
		part, partArgs := one(expr)
		parts = append(parts, part)
		args = append(args, partArgs...)
	}
	return strings.Join(parts, " OR "), args
}
