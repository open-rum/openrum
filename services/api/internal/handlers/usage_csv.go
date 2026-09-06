package handlers

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"
)

func (handler *UsageHandler) CSV(writer http.ResponseWriter, request *http.Request) {
	result, ok := handler.read(writer, request)
	if !ok {
		return
	}
	writer.Header().Set("Content-Type", "text/csv; charset=utf-8")
	writer.Header().Set("Content-Disposition", `attachment; filename="openrum-usage.csv"`)
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(http.StatusOK)
	output := csv.NewWriter(writer)
	_ = output.Write([]string{"bucket", "event_type", "outcome", "reason", "events", "estimated", "bytes"})
	for _, row := range result.Breakdown {
		_ = output.Write([]string{
			row.Bucket.UTC().Format(timeFormat), safeCSVText(row.EventType), safeCSVText(row.Outcome), safeCSVText(row.Reason),
			strconv.FormatUint(row.Events, 10), strconv.FormatFloat(row.Estimated, 'f', -1, 64), strconv.FormatUint(row.Bytes, 10),
		})
	}
	output.Flush()
}

func safeCSVText(value string) string {
	trimmed := strings.TrimLeft(value, " \t\r\n")
	if trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
		return "'" + value
	}
	return value
}
