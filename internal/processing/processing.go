// Package processing holds the per-project rules that rewrite an event after
// it has been normalized and before it is stored.
//
// Two things live here, and they share a package because they share a moment
// in the pipeline rather than a subject: URL rules decide how a path is
// aggregated, and scrub rules decide what text never reaches storage. Both are
// applied by the consumer, which is the only stage that still holds the whole
// canonical event and is the only stage a project cannot bypass.
//
// Neither is offered to the browser SDK. The built-in equivalents — the
// identifier heuristics in event.NormalizeURL and the patterns in
// internal/privacy — already run before these do, so a project's rules are an
// addition to a floor, never a replacement for it. That is what makes it safe
// to let a project write them: the worst a bad rule can do is over-collapse a
// path or over-redact a string, and neither weakens the guarantees the SDK
// documents.
package processing

// Settings is the stored form of both rule sets. They are read together
// because they live in the same project row and are applied in the same pass.
type Settings struct {
	URL   URLRules   `json:"url,omitempty"`
	Scrub ScrubRules `json:"scrub,omitempty"`
}

// Compiled is the evaluation-ready form of Settings. Patterns are compiled once
// per settings version rather than once per event.
type Compiled struct {
	URL   *CompiledURLRules
	Scrub *CompiledScrubRules
}

// Compile validates both rule sets and prepares them for evaluation.
func Compile(settings Settings) (*Compiled, error) {
	url, err := settings.URL.Compile()
	if err != nil {
		return nil, err
	}
	scrub, err := settings.Scrub.Compile()
	if err != nil {
		return nil, err
	}
	return &Compiled{URL: url, Scrub: scrub}, nil
}

// Active reports whether anything is configured. An inactive set skips the
// rewrite pass entirely, which is the common case for a project that has never
// opened the settings page.
func (compiled *Compiled) Active() bool {
	return compiled != nil && (compiled.URL.Active() || compiled.Scrub.Active())
}
