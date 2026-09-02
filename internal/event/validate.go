package event

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

var (
	compileSchemaOnce sync.Once
	compiledSchema    *jsonschema.Schema
	compileSchemaErr  error
)

func ValidateEnvelopeV1(data []byte) error {
	schema, err := envelopeSchema()
	if err != nil {
		return err
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return fmt.Errorf("decode envelope: %w", err)
	}
	if err := schema.Validate(value); err != nil {
		return fmt.Errorf("validate envelope: %w", err)
	}
	return nil
}

func envelopeSchema() (*jsonschema.Schema, error) {
	compileSchemaOnce.Do(func() {
		compiler := jsonschema.NewCompiler()
		compiler.AssertFormat()
		var schemaDocument any
		if err := json.Unmarshal(EnvelopeV1Schema, &schemaDocument); err != nil {
			compileSchemaErr = err
			return
		}
		if err := compiler.AddResource("envelope-v1.json", schemaDocument); err != nil {
			compileSchemaErr = err
			return
		}
		compiledSchema, compileSchemaErr = compiler.Compile("envelope-v1.json")
	})
	return compiledSchema, compileSchemaErr
}
