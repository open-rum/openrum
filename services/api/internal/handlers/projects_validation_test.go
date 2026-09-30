package handlers

import (
	"strings"
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

	custom := []string{"production", "canary"}
	if _, ok := validateUpdateProject(updateProjectRequest{Environments: &custom}); ok {
		t.Fatal("expected an environment outside the fixed set to be rejected")
	}
	all := []string{"development", "test", "staging", "production"}
	if _, ok := validateUpdateProject(updateProjectRequest{Environments: &all}); !ok {
		t.Fatal("expected all four fixed environments to be accepted")
	}
	customDefault := "preview"
	if _, ok := validateUpdateProject(updateProjectRequest{Environment: &customDefault}); ok {
		t.Fatal("expected a default outside the fixed set to be rejected")
	}
}

func TestValidateCreateProjectGeneratesSlugWhenOmitted(t *testing.T) {
	for name, prefix := range map[string]string{
		"Shop H5 (Demo)": "shop-h5-demo-",
		"商城 H5":          "h5-",
		"商城":             "project-",
	} {
		input, ok := validateCreateProject(createProjectRequest{
			Name: name, AllowedOrigins: []string{"https://example.com"},
		}, uuid.New())
		if !ok {
			t.Fatalf("%q: expected project input to be valid", name)
		}
		if !strings.HasPrefix(input.Slug, prefix) || !validSlug(input.Slug) {
			t.Fatalf("%q: slug = %q, want valid slug with prefix %q", name, input.Slug, prefix)
		}
	}
	first := generatedProjectSlug("Storefront")
	if first == generatedProjectSlug("Storefront") {
		t.Fatalf("generated slugs repeat: %q", first)
	}
}
