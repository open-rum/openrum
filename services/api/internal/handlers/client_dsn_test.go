package handlers

import "testing"

func TestClientDSNContainsEndpointAndPublicWriteKey(t *testing.T) {
	t.Parallel()
	got := clientDSN("https://ingest.example.com/openrum/v1/envelope", "orr_pk_test")
	want := "https://orr_pk_test@ingest.example.com/openrum/v1/envelope"
	if got != want {
		t.Fatalf("clientDSN()=%q want=%q", got, want)
	}
}

func TestClientDSNRejectsInvalidInput(t *testing.T) {
	t.Parallel()
	for _, input := range []struct {
		endpoint string
		key      string
	}{
		{endpoint: "/relative", key: "orr_pk_test"},
		{endpoint: "ftp://ingest.example.com/ingest/v1/envelope", key: "orr_pk_test"},
		{endpoint: "https://user@ingest.example.com/ingest/v1/envelope", key: "orr_pk_test"},
		{endpoint: "https://ingest.example.com/ingest/v1/envelope", key: ""},
	} {
		if got := clientDSN(input.endpoint, input.key); got != "" {
			t.Fatalf("clientDSN(%q, %q)=%q want empty", input.endpoint, input.key, got)
		}
	}
}
