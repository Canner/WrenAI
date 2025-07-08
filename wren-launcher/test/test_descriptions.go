package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Canner/WrenAI/wren-launcher/commands/dbt"
)

// MockDataSource implements the DataSource interface for testing
type MockDataSource struct{}

func (m *MockDataSource) GetType() string {
	return "mock"
}

func (m *MockDataSource) Validate() error {
	return nil
}

func (m *MockDataSource) MapType(sourceType string) string {
	// Simple type mapping for testing
	switch sourceType {
	case "INTEGER":
		return "int"
	case "VARCHAR":
		return "string"
	case "TIMESTAMP":
		return "timestamp"
	case "DOUBLE":
		return "double"
	case "BOOLEAN":
		return "boolean"
	default:
		return "string"
	}
}

func testDescriptionsMain() {
	// Test the converter with manifest.json
	workingDir, _ := os.Getwd()
	parentDir := filepath.Dir(workingDir)

	// Assuming we have test files in the parent directory
	catalogPath := filepath.Join(parentDir, "test_catalog.json")
	manifestPath := filepath.Join(parentDir, "test_manifest.json")

	// Create a mock data source
	dataSource := &MockDataSource{}

	// Convert with manifest
	manifest, err := dbt.ConvertDbtCatalogToWrenMDL(catalogPath, dataSource, manifestPath)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	// Print the result to verify descriptions are included
	output, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		fmt.Printf("Error marshaling JSON: %v\n", err)
		return
	}

	fmt.Println("Generated Wren MDL with descriptions:")
	fmt.Println(string(output))
}
