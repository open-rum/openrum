package query

import (
	"strings"

	"github.com/google/uuid"

	"openrum/internal/metadata"
	"openrum/internal/search"
)

// IssueStateSearch is the part of an Issues search that reads an Issue's workflow state
// rather than its events: is:unresolved, is:new, assigned:me and the like. Those live in
// Postgres, not ClickHouse, so they are taken out of the query before it is compiled.
type IssueStateSearch struct {
	Status metadata.IssueStatus
	// Assignee is "", AssigneeNone, AssigneeAny, AssigneeMe or a user UUID.
	Assignee string
	NewOnly  bool
}

// AssigneeAny is the Assignee filter value for Issues somebody owns (is:assigned).
const AssigneeAny = "any"

// AssigneeMe stands for the caller until the handler, which knows who that is, replaces it.
const AssigneeMe = "me"

// SplitIssueStateSearch takes the workflow-state conditions out of an Issues search. The
// rest of the query comes back with those conditions blanked to spaces rather than removed,
// so an error the search package reports later still points at the right place.
func SplitIssueStateSearch(input string) (string, IssueStateSearch, error) {
	var state IssueStateSearch
	terms, err := search.Parse(input)
	if err != nil {
		return input, state, err
	}
	rest := []byte(input)
	for _, term := range terms {
		if term.Field != "is" && term.Field != "assigned" {
			continue
		}
		fail := func(code string) (string, IssueStateSearch, error) {
			return input, IssueStateSearch{}, &search.Error{Code: code, Position: term.Position, Term: term.Raw}
		}
		if term.Negated || term.Operator != search.OpEquals || len(term.Values) != 1 {
			return fail(search.CodeUnsupported)
		}
		value := strings.ToLower(term.Values[0])
		switch {
		case term.Field == "assigned":
			switch value {
			case "me", "none":
				if state.Assignee != "" {
					return fail(search.CodeInvalidValue)
				}
				state.Assignee = value
			default:
				if _, err := uuid.Parse(value); err != nil || state.Assignee != "" {
					return fail(search.CodeInvalidValue)
				}
				state.Assignee = value
			}
		case value == "new":
			state.NewOnly = true
		case value == "assigned" || value == "unassigned":
			if state.Assignee != "" {
				return fail(search.CodeInvalidValue)
			}
			state.Assignee = map[string]string{"assigned": AssigneeAny, "unassigned": AssigneeNone}[value]
		case validIssueStatus(metadata.IssueStatus(value)) && value != "":
			if state.Status != "" {
				return fail(search.CodeInvalidValue)
			}
			state.Status = metadata.IssueStatus(value)
		default:
			return fail(search.CodeInvalidValue)
		}
		for index := term.Position; index < term.Position+len(term.Raw); index++ {
			rest[index] = ' '
		}
	}
	return string(rest), state, nil
}

// matchesStatus applies a status filter. Unresolved includes regressed: an Issue that failed
// again after it was resolved needs handling as much as one never resolved.
func matchesStatus(filter, status metadata.IssueStatus) bool {
	switch filter {
	case "":
		return true
	case metadata.IssueStatusUnresolved:
		return status == metadata.IssueStatusUnresolved || status == metadata.IssueStatusRegressed
	default:
		return status == filter
	}
}
