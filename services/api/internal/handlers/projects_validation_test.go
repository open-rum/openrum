package handlers

import (
	"testing"

	"github.com/google/uuid"

	"openrum/internal/metadata"
)

func TestValidateCreateProjectNormalizesEnvironments(t *testing.T) {
	input, ok := validateCreateProject(createProjectRequest{
		Name:           "Storefront",
		Slug:           "storefront",
		SDKPlatform:    "react",
		AllowedOrigins: []string{"https://example.com"},
		Environment:    "production",
		Environments:   []string{"test", "production", "test"},
	}, uuid.New())
	if !ok {
		t.Fatal("expected project input to be valid")
	}
	if input.SDKPlatform != "react" {
		t.Fatalf("sdk platform = %q, want react", input.SDKPlatform)
	}
	want := []string{"production", "test"}
	if len(input.Environments) != len(want) {
		t.Fatalf("environments = %v, want %v", input.Environments, want)
	}
	for index := range want {
		if input.Environments[index] != want[index] {
			t.Fatalf("environments = %v, want %v", input.Environments, want)
		}
	}
}

func TestValidateProjectRejectsUnknownSDKPlatform(t *testing.T) {
	if _, ok := validateCreateProject(createProjectRequest{
		Name: "Storefront", Slug: "storefront", SDKPlatform: "rails",
		AllowedOrigins: []string{"https://example.com"},
	}, uuid.New()); ok {
		t.Fatal("expected unknown SDK platform to be rejected")
	}
	unknown := metadata.SDKPlatform("rails")
	if _, ok := validateUpdateProject(updateProjectRequest{SDKPlatform: &unknown}); ok {
		t.Fatal("expected unknown SDK platform update to be rejected")
	}
}

func TestValidateCreateProjectDefaultsSDKPlatform(t *testing.T) {
	input, ok := validateCreateProject(createProjectRequest{
		Name: "Storefront", Slug: "storefront",
		AllowedOrigins: []string{"https://example.com"},
	}, uuid.New())
	if !ok || input.SDKPlatform != metadata.SDKPlatformJavaScript {
		t.Fatalf("sdk platform = %q, valid = %v; want javascript", input.SDKPlatform, ok)
	}
}

func TestValidateUpdateProjectRejectsInvalidEnvironmentSets(t *testing.T) {
	empty := []string{}
	if _, ok := validateUpdateProject(updateProjectRequest{Environments: &empty}); ok {
		t.Fatal("expected an empty environment set to be rejected")
	}
	invalid := []string{"Production"}
	if _, ok := validateUpdateProject(updateProjectRequest{Environments: &invalid}); ok {
		t.Fatal("expected an invalid environment name to be rejected")
	}

	full := []string{
		"environment-01", "environment-02", "environment-03", "environment-04",
		"environment-05", "environment-06", "environment-07", "environment-08",
		"environment-09", "environment-10", "environment-11", "environment-12",
		"environment-13", "environment-14", "environment-15", "environment-16",
	}
	newDefault := "production"
	if _, ok := validateUpdateProject(updateProjectRequest{Environment: &newDefault, Environments: &full}); ok {
		t.Fatal("expected adding a default to a full environment set to be rejected")
	}
}
