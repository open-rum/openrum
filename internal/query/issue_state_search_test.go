package query

import (
	"errors"
	"strings"
	"testing"

	"openrum/internal/metadata"
	"openrum/internal/search"
)

func TestSplitIssueStateSearchTakesOutStatusOwnerAndNew(t *testing.T) {
	input := "is:unresolved AND browser:Chrome assigned:me is:new"
	rest, state, err := SplitIssueStateSearch(input)
	if err != nil {
		t.Fatal(err)
	}
	want := IssueStateSearch{Status: metadata.IssueStatusUnresolved, Assignee: AssigneeMe, NewOnly: true}
	if state != want {
		t.Fatalf("state = %#v", state)
	}
	// The rest keeps every other condition at its original position.
	if len(rest) != len(input) || strings.Index(rest, "browser:Chrome") != strings.Index(input, "browser:Chrome") ||
		strings.TrimSpace(rest) != "AND browser:Chrome" {
		t.Fatalf("rest = %q", rest)
	}
	if _, _, err := issueSchema.ParseAndCompile(rest, search.Raw); err != nil {
		t.Fatalf("rest does not compile: %v", err)
	}
}

func TestSplitIssueStateSearchReadsOwnerShorthands(t *testing.T) {
	for input, assignee := range map[string]string{
		"is:unassigned": AssigneeNone, "is:assigned": AssigneeAny, "assigned:none": AssigneeNone,
	} {
		_, state, err := SplitIssueStateSearch(input)
		if err != nil || state.Assignee != assignee {
			t.Fatalf("%s: state=%#v err=%v", input, state, err)
		}
	}
}

func TestSplitIssueStateSearchRefusesWhatItCannotApply(t *testing.T) {
	for _, input := range []string{
		"is:bogus", "!is:new", "is:[resolved,ignored]", "is:resolved is:ignored", "assigned:someone", "is:un*",
	} {
		_, _, err := SplitIssueStateSearch(input)
		var searchError *search.Error
		if !errors.As(err, &searchError) {
			t.Fatalf("%s: err=%v", input, err)
		}
	}
}

func TestUnresolvedIncludesRegressed(t *testing.T) {
	if !matchesStatus(metadata.IssueStatusUnresolved, metadata.IssueStatusRegressed) {
		t.Fatal("unresolved must include regressed Issues")
	}
	if matchesStatus(metadata.IssueStatusRegressed, metadata.IssueStatusUnresolved) {
		t.Fatal("regressed must not include unresolved Issues")
	}
}
