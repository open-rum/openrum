package ingest

import (
	"fmt"
	"testing"

	"openrum/internal/metadata"
)

func TestProjectQuotaFallsBackToTheInstanceDefault(t *testing.T) {
	if limit := (ProjectQuota{}).Limit(); limit != DefaultProjectRequestsPerSecond {
		t.Fatalf("unset quota resolved to %d, want the instance default", limit)
	}
	if limit := (ProjectQuota{RequestsPerSecond: 25}).Limit(); limit != 25 {
		t.Fatalf("override resolved to %d, want 25", limit)
	}
}

func TestAdmitProjectAllowsEverythingUnderTheLimit(t *testing.T) {
	for _, behavior := range []metadata.OverLimitBehavior{metadata.OverLimitReject, metadata.OverLimitSample} {
		if !admitProject(10, 0, 0, 10, behavior, "203.0.113.7") {
			t.Fatalf("the last request under the limit was refused in %q mode", behavior)
		}
	}
}

func TestAdmitProjectRejectModeIsExact(t *testing.T) {
	if admitProject(11, 0, 0, 10, metadata.OverLimitReject, "203.0.113.7") {
		t.Fatal("reject mode admitted a request over the limit")
	}
}

func TestAdmitProjectSampleModeShedsWholeCallers(t *testing.T) {
	// The same caller must get the same answer for the whole window, otherwise
	// a session would be reported with holes in it rather than not at all.
	const limit, count, previous = 10, 11, 30
	for _, caller := range []string{"203.0.113.7", "198.51.100.4", "192.0.2.9"} {
		first := admitProject(count, previous, 0, limit, metadata.OverLimitSample, caller)
		for range 5 {
			if admitProject(count, previous, 0, limit, metadata.OverLimitSample, caller) != first {
				t.Fatalf("caller %q got two different answers in one window", caller)
			}
		}
	}
}

func TestAdmitProjectSampleModeAdmitsRoughlyTheLimit(t *testing.T) {
	// Three times the limit offered, so about a third of callers should pass.
	const limit, offered = 100, 300
	admitted := 0
	for caller := range offered {
		if admitProject(offered, offered, 0, limit, metadata.OverLimitSample, fmt.Sprintf("198.51.100.%d", caller)) {
			admitted++
		}
	}
	if admitted < limit/2 || admitted > limit*2 {
		t.Fatalf("admitted %d of %d callers, want roughly %d", admitted, offered, limit)
	}
}

func TestAdmitProjectSampleModeStopsAtTheCeiling(t *testing.T) {
	// The ceiling is measured against admissions, not against offered load, so
	// it engages once the window has already let through its allowance.
	const limit = 10
	admittedOver := int64(limit * (maxSampleOvershoot - 1))
	for caller := range 50 {
		if admitProject(limit+1, 0, admittedOver, limit, metadata.OverLimitSample,
			fmt.Sprintf("198.51.100.%d", caller)) {
			t.Fatal("sample mode admitted a request past the overshoot ceiling")
		}
	}
}

func TestAdmitProjectSampleModeSurvivesHeavyOverload(t *testing.T) {
	// Ten times over the limit is exactly where a ceiling measured against
	// offered load would refuse everything, leaving sample mode worse than the
	// exact cap it was chosen over.
	const limit, offered = 100, 1_000
	admitted := 0
	for caller := range offered {
		if admitProject(offered, offered, int64(max(0, admitted-limit)), limit,
			metadata.OverLimitSample, fmt.Sprintf("198.51.100.%d.%d", caller/256, caller%256)) {
			admitted++
		}
	}
	if admitted == 0 {
		t.Fatal("sample mode admitted nothing under heavy overload")
	}
	if int64(admitted) > limit*maxSampleOvershoot {
		t.Fatalf("admitted %d, want at most %d", admitted, limit*maxSampleOvershoot)
	}
}
