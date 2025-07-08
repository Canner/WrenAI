package dbt

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/pterm/pterm"
)

// ConvertDbtCatalogToWrenMDL converts dbt catalog.json to Wren MDL format
func ConvertDbtCatalogToWrenMDL(catalogPath string, data_source DataSource) (*WrenMDLManifest, error) {
	// Read and parse the catalog.json file
	data, err := os.ReadFile(catalogPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read catalog file %s: %w", catalogPath, err)
	}

	var catalogData map[string]interface{}
	if err := json.Unmarshal(data, &catalogData); err != nil {
		return nil, fmt.Errorf("failed to parse catalog JSON: %w", err)
	}

	// Extract nodes
	nodesValue, exists := catalogData["nodes"]
	if !exists {
		return nil, fmt.Errorf("no 'nodes' section found in catalog")
	}

	nodesMap, ok := nodesValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid 'nodes' format in catalog")
	}

	// Initialize Wren MDL manifest
	manifest := &WrenMDLManifest{
		Catalog:       "wren",   // Default catalog name
		Schema:        "public", // Default schema name
		Models:        []WrenModel{},
		Relationships: []Relationship{},
		Views:         []View{},
	}

	// Convert each dbt model to Wren model
	for nodeKey, nodeValue := range nodesMap {
		nodeMap, ok := nodeValue.(map[string]interface{})
		if !ok {
			continue
		}

		// Only process models (skip seeds, tests, etc.)
		if !strings.HasPrefix(nodeKey, "model.") {
			continue
		}

		// Skip staging models
		if strings.Contains(nodeKey, ".stg_") || strings.Contains(nodeKey, ".staging_") {
			continue
		}

		model, err := convertDbtNodeToWrenModel(nodeKey, nodeMap, data_source)
		if err != nil {
			pterm.Warning.Printf("Warning: Failed to convert model %s: %v\n", nodeKey, err)
			continue
		}

		manifest.Models = append(manifest.Models, *model)
	}

	return manifest, nil
}

// convertDbtNodeToWrenModel converts a single dbt node to Wren model
func convertDbtNodeToWrenModel(nodeKey string, nodeData map[string]interface{}, data_source DataSource) (*WrenModel, error) {
	// Extract model name from node key (e.g., "model.jaffle_shop.customers" -> "customers")
	parts := strings.Split(nodeKey, ".")
	if len(parts) < 3 {
		return nil, fmt.Errorf("invalid node key format: %s", nodeKey)
	}
	modelName := parts[len(parts)-1]

	// Extract metadata
	metadataValue, exists := nodeData["metadata"]
	if !exists {
		return nil, fmt.Errorf("no metadata found for model %s", nodeKey)
	}

	metadata, ok := metadataValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid metadata format for model %s", nodeKey)
	}

	// Create table reference
	tableRef := TableReference{
		Table: getStringFromMap(metadata, "name", modelName),
	}

	if catalog := getStringFromMap(metadata, "database", ""); catalog != "" {
		tableRef.Catalog = catalog
	}
	if schema := getStringFromMap(metadata, "schema", ""); schema != "" {
		tableRef.Schema = schema
	}

	// Convert columns
	columnsValue, exists := nodeData["columns"]
	if !exists {
		return nil, fmt.Errorf("no columns found for model %s", nodeKey)
	}

	columnsMap, ok := columnsValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid columns format for model %s", nodeKey)
	}

	var wrenColumns []WrenColumn
	for _, colValue := range columnsMap {
		colMap, ok := colValue.(map[string]interface{})
		if !ok {
			continue
		}

		column := WrenColumn{
			Name: getStringFromMap(colMap, "name", ""),
			Type: data_source.MapType(getStringFromMap(colMap, "type", "")),
		}

		// Set notNull based on comment or other indicators
		// This is a basic implementation - you might need more sophisticated logic
		if comment := getStringFromMap(colMap, "comment", ""); comment != "" {
			if column.Properties == nil {
				column.Properties = make(map[string]string)
			}
			column.Properties["comment"] = comment
		}

		wrenColumns = append(wrenColumns, column)
	}

	// Sort columns by index if available
	sort.Slice(wrenColumns, func(i, j int) bool {
		// This is a simplified sort - you might want to use the index from dbt
		return wrenColumns[i].Name < wrenColumns[j].Name
	})

	model := &WrenModel{
		Name:           modelName,
		TableReference: tableRef,
		Columns:        wrenColumns,
	}

	return model, nil
}

// getStringFromMap safely extracts a string value from a map
func getStringFromMap(m map[string]interface{}, key, defaultValue string) string {
	if value, exists := m[key]; exists {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return defaultValue
}
