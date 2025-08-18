package dbt

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/pterm/pterm"
)

// Note: All struct definitions (WrenMDLManifest, WrenModel, etc.) are defined
// in wren_mdl.go to prevent "redeclared in this block" compilation errors.

// ConvertOptions holds the options for dbt project conversion
type ConvertOptions struct {
	ProjectPath          string
	OutputDir            string
	ProfileName          string
	Target               string
	RequireCatalog       bool // if true, missing catalog.json is an error; if false, it's a warning
	UsedByContainer      bool // if true, used by container, no need to print usage info
	IncludeStagingModels bool // if true, staging models will be included in the conversion
}

// ConvertResult holds the result of dbt project conversion
type ConvertResult struct {
	LocalStoragePath    string
	DataSourceGenerated bool
	ModelsCount         int
}

// ConvertDbtProjectCore contains the core logic for converting dbt projects
// This function is used by both DbtAutoConvert and processDbtProject
func ConvertDbtProjectCore(opts ConvertOptions) (*ConvertResult, error) {
	// Validate dbt project
	if !IsDbtProjectValid(opts.ProjectPath) {
		return nil, fmt.Errorf("invalid dbt project path: %s", opts.ProjectPath)
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(opts.OutputDir, 0750); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	pterm.Info.Printf("Processing dbt project at: %s\n", opts.ProjectPath)
	pterm.Info.Printf("Output directory: %s\n", opts.OutputDir)

	// Search for profiles.yml
	profilesPath, err := FindProfilesFile(opts.ProjectPath)
	if err != nil {
		pterm.Warning.Printf("Warning: Could not find profiles.yml: %v\n", err)
		pterm.Info.Println("Skipping data source conversion...")
	}

	// Search for catalog.json, manifest.json, and semantic_manifest.json in target directory
	targetDir := filepath.Join(opts.ProjectPath, "target")
	catalogPath := filepath.Join(targetDir, "catalog.json")
	manifestPath := filepath.Join(targetDir, "manifest.json")
	semanticManifestPath := filepath.Join(targetDir, "semantic_manifest.json")

	if !FileExists(catalogPath) {
		if opts.RequireCatalog {
			return nil, fmt.Errorf("catalog.json not found at: %s. Hint: Run 'dbt docs generate' to create catalog.json", catalogPath)
		} else {
			pterm.Warning.Printf("Warning: catalog.json not found at: %s\n", catalogPath)
			pterm.Info.Println("Hint: Run 'dbt docs generate' to create catalog.json")
			return &ConvertResult{LocalStoragePath: "."}, nil
		}
	}

	// Check for manifest.json (optional but recommended for descriptions and relationships)
	var manifestPathForConversion string
	if FileExists(manifestPath) {
		pterm.Info.Printf("Found manifest.json at: %s\n", manifestPath)
		manifestPathForConversion = manifestPath
	} else {
		pterm.Warning.Printf("Warning: manifest.json not found at: %s\n", manifestPath)
		pterm.Info.Println("Model descriptions, column descriptions, and relationships will not be included")
	}

	// Check for semantic_manifest.json (optional)
	var semanticManifestPathForConversion string
	if FileExists(semanticManifestPath) {
		pterm.Info.Printf("Found semantic_manifest.json at: %s\n", semanticManifestPath)
		semanticManifestPathForConversion = semanticManifestPath
	} else {
		pterm.Info.Println("semantic_manifest.json not found, skipping metric and primary key conversion.")
	}

	// Convert profiles.yml to WrenDataSource (if profiles found)
	var dataSourceGenerated bool
	var ds DataSource
	localStoragePath := "." // default value

	if profilesPath != "" {
		pterm.Info.Printf("Found profiles.yml at: %s\n", profilesPath)

		// Analyze profiles
		profiles, err := AnalyzeDbtProfiles(profilesPath)
		if err != nil {
			return nil, fmt.Errorf("failed to analyze profiles: %w", err)
		}

		// Display available profiles if no specific profile is requested
		if opts.ProfileName == "" {
			pterm.Info.Println("Available profiles:")
			for name := range profiles.Profiles {
				pterm.Info.Printf("  - %s\n", name)
			}
			pterm.Info.Println("Using first available profile (specify --profile to select a specific one)")
		}

		// Get active data sources
		dataSources, err := GetActiveDataSources(profiles, opts.ProjectPath, opts.ProfileName, opts.Target)
		if err != nil {
			return nil, fmt.Errorf("failed to get data sources: %w", err)
		}

		if len(dataSources) == 0 {
			pterm.Warning.Println("Warning: No active data sources found")
			dataSourceGenerated = false
		} else {
			// Use the first data source
			ds = dataSources[0]

			// Check if the first data source is duckdb (local file)
			if localFileDS, ok := dataSources[0].(*WrenLocalFileDataSource); ok {
				localStoragePath = localFileDS.Url
				pterm.Info.Printf("Found DuckDB data source, using local storage path: %s\n", localStoragePath)
			}

			// Create WrenDataSource JSON
			var wrenDataSource map[string]interface{}

			switch typedDS := ds.(type) {
			case *WrenPostgresDataSource:
				var host string
				if opts.UsedByContainer {
					host = handleLocalhostForContainer(typedDS.Host)
				} else {
					host = typedDS.Host
				}
				wrenDataSource = map[string]interface{}{
					"type": "postgres",
					"properties": map[string]interface{}{
						"host":     host,
						"port":     typedDS.Port,
						"database": typedDS.Database,
						"user":     typedDS.User,
						"password": typedDS.Password,
					},
				}
			case *WrenLocalFileDataSource:
				var url string
				if opts.UsedByContainer {
					// For container usage, the file path will be mounted to the following path
					url = "/usr/src/app/data"
				} else {
					url = typedDS.Url
				}
				wrenDataSource = map[string]interface{}{
					"type": "local_file",
					"properties": map[string]interface{}{
						"url":    url,
						"format": typedDS.Format,
					},
				}
			case *WrenBigQueryDataSource:
				wrenDataSource = map[string]interface{}{
					"type": "bigquery",
					"properties": map[string]interface{}{
						"project_id":  typedDS.Project,
						"dataset_id":  typedDS.Dataset,
						"credentials": typedDS.Credentials,
					},
				}
			case *WrenMysqlDataSource:
				wrenDataSource = map[string]interface{}{
					"type": "mysql",
					"properties": map[string]interface{}{
						"host":     typedDS.Host,
						"port":     typedDS.Port,
						"database": typedDS.Database,
						"user":     typedDS.User,
						"password": typedDS.Password,
						"sslMode":  typedDS.SslMode,
					},
				}
			default:
				pterm.Warning.Printf("Warning: Unsupported data source type: %s\n", ds.GetType())
				wrenDataSource = map[string]interface{}{
					"type":       ds.GetType(),
					"properties": map[string]interface{}{},
				}
			}

			// Write WrenDataSource JSON
			dataSourcePath := filepath.Join(opts.OutputDir, "wren-datasource.json")
			dataSourceJSON, err := json.MarshalIndent(wrenDataSource, "", "  ")
			if err != nil {
				return nil, fmt.Errorf("failed to marshal data source JSON: %w", err)
			}

			if err := os.WriteFile(dataSourcePath, dataSourceJSON, 0600); err != nil {
				return nil, fmt.Errorf("failed to write data source file: %w", err)
			}

			pterm.Success.Printf("✓ WrenDataSource saved to: %s\n", dataSourcePath)
			dataSourceGenerated = true
		}
	}

	// Convert catalog.json to Wren MDL
	pterm.Info.Printf("Converting catalog.json from: %s\n", catalogPath)

	// Create a default data source if none was found
	if ds == nil {
		ds = &DefaultDataSource{}
	}

	manifest, err := ConvertDbtCatalogToWrenMDL(catalogPath, ds, manifestPathForConversion, semanticManifestPathForConversion, opts.IncludeStagingModels)
	if err != nil {
		return nil, fmt.Errorf("failed to convert catalog: %w", err)
	}

	// Write Wren MDL JSON
	mdlPath := filepath.Join(opts.OutputDir, "wren-mdl.json")
	mdlJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal MDL JSON: %w", err)
	}

	if err := os.WriteFile(mdlPath, mdlJSON, 0600); err != nil {
		return nil, fmt.Errorf("failed to write MDL file: %w", err)
	}

	pterm.Success.Printf("✓ Wren MDL saved to: %s\n", mdlPath)

	// Summary
	pterm.Success.Println("\n🎉 Conversion completed successfully!")
	pterm.Info.Printf("Models converted: %d\n", len(manifest.Models))
	pterm.Info.Printf("Relationships generated: %d\n", len(manifest.Relationships))
	pterm.Info.Printf("Metrics generated: %d\n", len(manifest.Metrics))
	pterm.Info.Printf("Enums generated: %d\n", len(manifest.EnumDefinitions))

	if dataSourceGenerated {
		pterm.Info.Println("Generated files:")
		pterm.Info.Printf("  - WrenDataSource: %s\n", filepath.Join(opts.OutputDir, "wren-datasource.json"))
		pterm.Info.Printf("  - Wren MDL: %s\n", filepath.Join(opts.OutputDir, "wren-mdl.json"))
	} else {
		pterm.Info.Println("Generated files:")
		pterm.Info.Printf("  - Wren MDL: %s\n", filepath.Join(opts.OutputDir, "wren-mdl.json"))
		if profilesPath != "" {
			pterm.Warning.Println("  - WrenDataSource: Not generated (no compatible data sources found)")
		} else {
			pterm.Warning.Println("  - WrenDataSource: Not generated (profiles.yml not found)")
		}
	}

	return &ConvertResult{
		LocalStoragePath:    localStoragePath,
		DataSourceGenerated: dataSourceGenerated,
		ModelsCount:         len(manifest.Models),
	}, nil
}

func handleLocalhostForContainer(host string) string {
	// If the host is localhost, we need to handle it for container usage
	if host == "localhost" || host == "127.0.0.1" {
		// For container usage, we can use the host network or a specific IP.
		// "host.docker.internal" is a special DNS name that resolves to the internal IP address of the host.
		// It's supported on Docker Desktop for Mac and Windows, and in Docker Engine 20.10+ for Linux.
		// This makes it a reliable default for accessing host services from within a container.
		return "host.docker.internal"
	}
	return host
}

// ConvertDbtCatalogToWrenMDL converts dbt catalog.json to Wren MDL format
func ConvertDbtCatalogToWrenMDL(catalogPath string, dataSource DataSource, manifestPath string, semanticManifestPath string, includeStagingModels bool) (*WrenMDLManifest, error) {
	// Read and parse the catalog.json file
	data, err := os.ReadFile(catalogPath) // #nosec G304 -- catalogPath is controlled by application
	if err != nil {
		return nil, fmt.Errorf("failed to read catalog file %s: %w", catalogPath, err)
	}

	var catalogData map[string]interface{}
	if err := json.Unmarshal(data, &catalogData); err != nil {
		return nil, fmt.Errorf("failed to parse catalog JSON: %w", err)
	}

	// Parse manifest.json for descriptions and relationships (optional)
	var manifestData map[string]interface{}
	if manifestPath != "" {
		pterm.Info.Printf("Reading manifest.json for descriptions and relationships from: %s\n", manifestPath)
		manifestBytes, err := os.ReadFile(manifestPath) // #nosec G304 -- manifestPath is controlled by application
		if err != nil {
			pterm.Warning.Printf("Warning: Failed to read manifest file %s: %v\n", manifestPath, err)
		} else {
			if err := json.Unmarshal(manifestBytes, &manifestData); err != nil {
				pterm.Warning.Printf("Warning: Failed to parse manifest JSON: %v\n", err)
			}
		}
	}

	// Parse semantic_manifest.json for metrics and primary keys (optional and robust)
	var semanticManifestData map[string]interface{}
	if semanticManifestPath != "" {
		pterm.Info.Printf("Reading semantic_manifest.json for metrics and primary keys from: %s\n", semanticManifestPath)
		semanticBytes, err := os.ReadFile(semanticManifestPath)
		if err != nil {
			pterm.Warning.Printf("Warning: Could not read semantic_manifest.json: %v\n", err)
			pterm.Warning.Println("Skipping metric and primary key conversion.")
		} else {
			if err := json.Unmarshal(semanticBytes, &semanticManifestData); err != nil {
				pterm.Warning.Printf("Warning: Failed to parse semantic_manifest.json: %v\n", err)
				pterm.Warning.Println("Skipping metric and primary key conversion.")
				semanticManifestData = nil
			}
		}
	}

	// Extract nodes from catalog
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
		Catalog:         "wren",
		Schema:          "public",
		EnumDefinitions: []EnumDefinition{},
		Models:          []WrenModel{},
		Relationships:   []Relationship{},
		Metrics:         []Metric{},
		Views:           []View{},
		DataSources:     dataSource.GetType(),
	}

	// Maps to store pre-processed information
	enumValueToNameMap := make(map[string]string)
	columnToEnumNameMap := make(map[string]string)
	columnToNotNullMap := make(map[string]bool)
	modelToPrimaryKeyMap := make(map[string]string)

	// Pre-process manifest to find all tests (enums, not_null)
	if manifestData != nil {
		if nodes, ok := manifestData["nodes"].(map[string]interface{}); ok {
			for nodeKey, nodeValue := range nodes {
				nodeMap, ok := nodeValue.(map[string]interface{})
				if !ok {
					continue
				}

				// Handle tests on model columns (including structs)
				if strings.HasPrefix(nodeKey, "model.") {
					modelName := getModelNameFromNodeKey(nodeKey)
					if modelName == "" {
						continue
					}
					if columns, ok := nodeMap["columns"].(map[string]interface{}); ok {
						for columnName, colData := range columns {
							if colMap, ok := colData.(map[string]interface{}); ok {
								processColumnForTests(nodeKey, modelName, columnName, colMap, &manifest.EnumDefinitions, enumValueToNameMap, columnToEnumNameMap, columnToNotNullMap)
							}
						}
					}
				}

				// Handle compiled test nodes for simple columns
				if strings.HasPrefix(nodeKey, "test.") {
					if testMeta, ok := nodeMap["test_metadata"].(map[string]interface{}); ok {
						testName := getStringFromMap(testMeta, "name", "")
						attachedNodeID := getStringFromMap(nodeMap, "attached_node", "")
						columnName := getStringFromMap(nodeMap, "column_name", "")
						modelName := getModelNameFromNodeKey(attachedNodeID)

						if attachedNodeID != "" && columnName != "" && modelName != "" {
							columnKey := fmt.Sprintf("%s.%s", attachedNodeID, columnName)

							if testName == "not_null" {
								columnToNotNullMap[columnKey] = true
							}

							if testName == "accepted_values" {
								if kwargs, ok := testMeta["kwargs"].(map[string]interface{}); ok {
									if values, ok := kwargs["values"].([]interface{}); ok && len(values) > 0 {
										createOrLinkEnum(modelName, columnName, columnKey, values, &manifest.EnumDefinitions, enumValueToNameMap, columnToEnumNameMap)
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Pre-process semantic manifest for primary keys
	if semanticManifestData != nil {
		if semanticModels, ok := semanticManifestData["semantic_models"].([]interface{}); ok {
			for _, sm := range semanticModels {
				if smMap, ok := sm.(map[string]interface{}); ok {
					var modelName string
					if nr, ok := smMap["node_relation"].(map[string]interface{}); ok {
						modelName = getStringFromMap(nr, "alias", "")
					}

					if entities, ok := smMap["entities"].([]interface{}); ok {
						for _, entity := range entities {
							if entityMap, ok := entity.(map[string]interface{}); ok {
								if getStringFromMap(entityMap, "type", "") == "primary" {
									pk := getStringFromMap(entityMap, "expr", "")
									if modelName != "" && pk != "" {
										modelToPrimaryKeyMap[modelName] = pk
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Convert each dbt model to Wren model
	for nodeKey, nodeValue := range nodesMap {
		nodeMap, ok := nodeValue.(map[string]interface{})
		if !ok {
			continue
		}
		if !strings.HasPrefix(nodeKey, "model.") {
			continue
		}
		if !includeStagingModels {
			mn := getModelNameFromNodeKey(nodeKey)
			if strings.HasPrefix(mn, "stg_") || strings.HasPrefix(mn, "staging_") {
				continue
			}
		}
		model, err := convertDbtNodeToWrenModel(nodeKey, nodeMap, dataSource, manifestData, columnToEnumNameMap, columnToNotNullMap, modelToPrimaryKeyMap)
		if err != nil {
			pterm.Warning.Printf("Warning: Failed to convert model %s: %v\n", nodeKey, err)
			continue
		}
		manifest.Models = append(manifest.Models, *model)
	}

	// Generate relationships from manifest.json
	if manifestData != nil {
		manifest.Relationships = generateRelationships(manifestData)
	}

	// Generate metrics from semantic_manifest.json, only if data is available
	if semanticManifestData != nil {
		manifest.Metrics = convertDbtMetricsToWrenMetrics(semanticManifestData)
	}

	return manifest, nil
}

// generateRelationships iterates through the manifest and creates relationship definitions.
func generateRelationships(manifestData map[string]interface{}) []Relationship {
	var relationships []Relationship
	if nodes, ok := manifestData["nodes"].(map[string]interface{}); ok {
		for nodeKey, nodeValue := range nodes {
			nodeMap, ok := nodeValue.(map[string]interface{})
			if !ok {
				continue
			}

			// Case 1: Handle tests on model columns (including structs)
			if strings.HasPrefix(nodeKey, "model.") {
				fromModelName := getModelNameFromNodeKey(nodeKey)
				if fromModelName == "" {
					continue
				}
				if columns, ok := nodeMap["columns"].(map[string]interface{}); ok {
					for columnName, colData := range columns {
						if colMap, ok := colData.(map[string]interface{}); ok {
							relationships = append(relationships, parseTestsForRelationships(fromModelName, columnName, colMap)...)
						}
					}
				}
			}

			// Case 2: Handle compiled test nodes for simple columns
			if strings.HasPrefix(nodeKey, "test.") {
				if testMeta, ok := nodeMap["test_metadata"].(map[string]interface{}); ok {
					if getStringFromMap(testMeta, "name", "") == "relationships" {
						if kwargs, ok := testMeta["kwargs"].(map[string]interface{}); ok {
							toRef := getStringFromMap(kwargs, "to", "")
							toField := getStringFromMap(kwargs, "field", "")
							toModelName := parseRef(toRef)
							fromColumnName := getStringFromMap(nodeMap, "column_name", "")
							attachedNodeID := getStringFromMap(nodeMap, "attached_node", "")
							fromModelName := getModelNameFromNodeKey(attachedNodeID)

							if toModelName != "" && toField != "" && fromModelName != "" && fromColumnName != "" {
								rel := Relationship{
									Name:      fmt.Sprintf("%s_to_%s_by_%s", fromModelName, toModelName, fromColumnName),
									Models:    []string{fromModelName, toModelName},
									JoinType:  "MANY_TO_ONE",
									Condition: fmt.Sprintf("%s.%s = %s.%s", fromModelName, fromColumnName, toModelName, toField),
								}
								relationships = append(relationships, rel)
							}
						}
					}
				}
			}
		}
	}
	seen := make(map[string]struct{}, len(relationships))
	var unique []Relationship
	for _, r := range relationships {
		key := r.Name  "|"  r.JoinType  "|"  r.Condition
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, r)
	}
	return unique
 }
}

// parseTestsForRelationships is a helper function to extract relationship tests from a column or its fields.
func parseTestsForRelationships(fromModelName, columnName string, colMap map[string]interface{}) []Relationship {
	var relationships []Relationship
	// Case 1: Tests are directly on the column.
	if tests, ok := colMap["tests"].([]interface{}); ok {
		relationships = append(relationships, extractRelationshipsFromTests(fromModelName, columnName, tests)...)
	}
	// Case 2: Tests are on fields within a struct column.
	if fields, ok := colMap["fields"].([]interface{}); ok {
		for _, fieldData := range fields {
			if fieldMap, ok := fieldData.(map[string]interface{}); ok {
				fieldName := getStringFromMap(fieldMap, "name", "")
				if fieldName == "" {
					continue
				}
				if tests, ok := fieldMap["tests"].([]interface{}); ok {
					relationships = append(relationships, extractRelationshipsFromTests(fromModelName, fieldName, tests)...)
				}
			}
		}
	}
	return relationships
}

// extractRelationshipsFromTests extracts relationship info from a 'tests' array.
func extractRelationshipsFromTests(fromModelName, fromColumnName string, tests []interface{}) []Relationship {
	var relationships []Relationship
	for _, test := range tests {
		if relTest, ok := test.(map[string]interface{}); ok {
			if relData, ok := relTest["relationships"].(map[string]interface{}); ok {
				toRef := getStringFromMap(relData, "to", "")
				toField := getStringFromMap(relData, "field", "")
				toModelName := parseRef(toRef)

				if toModelName != "" && toField != "" {
					rel := Relationship{
						Name:      fmt.Sprintf("%s_to_%s_by_%s", fromModelName, toModelName, fromColumnName),
						Models:    []string{fromModelName, toModelName},
						JoinType:  "MANY_TO_ONE",
						Condition: fmt.Sprintf("%s.%s = %s.%s", fromModelName, fromColumnName, toModelName, toField),
					}
					relationships = append(relationships, rel)
				}
			}
		}
	}
	return relationships
}

// createOrLinkEnum is a helper to de-duplicate and manage enum creation.
func createOrLinkEnum(modelName, columnName, columnKey string, values []interface{},
	allEnums *[]EnumDefinition, enumValueToNameMap, columnToEnumNameMap map[string]string) {

	var strValues []string
	for _, v := range values {
		if s, ok := v.(string); ok {
			strValues = append(strValues, s)
		}
	}
	if len(strValues) == 0 {
		return
	}
	sort.Strings(strValues)
	valueKey := strings.Join(strValues, ",")

	enumName, exists := enumValueToNameMap[valueKey]
	if !exists {
		enumName = fmt.Sprintf("%s_%s_Enum", modelName, columnName)
		// Sanitize enum name to be a valid identifier
		re := regexp.MustCompile(`[^a-zA-Z0-9_]`)
		enumName = re.ReplaceAllString(enumName, "_")
		if len(enumName) > 0 && enumName[0] >= '0' && enumName[0] <= '9' {
			enumName = "_" + enumName
		}
		*allEnums = append(*allEnums, EnumDefinition{
			Name:   enumName,
			Values: strValues,
		})
		enumValueToNameMap[valueKey] = enumName
	}
	columnToEnumNameMap[columnKey] = enumName
}

// processColumnForTests recursively finds tests in embedded column definitions.
func processColumnForTests(nodeKey, modelName, columnName string, colMap map[string]interface{},
	allEnums *[]EnumDefinition, enumValueToNameMap, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool) {

	// Helper to handle the actual test processing
	processTests := func(currentColumnKey, currentColumnName string, tests []interface{}) {
		for _, test := range tests {
			// Handle not_null test (string)
			if testStr, ok := test.(string); ok && testStr == "not_null" {
				columnToNotNullMap[currentColumnKey] = true
			}

			// Handle accepted_values test (map)
			if testMap, ok := test.(map[string]interface{}); ok {
				if accepted, ok := testMap["accepted_values"].(map[string]interface{}); ok {
					if values, ok := accepted["values"].([]interface{}); ok && len(values) > 0 {
						createOrLinkEnum(modelName, currentColumnName, currentColumnKey, values, allEnums, enumValueToNameMap, columnToEnumNameMap)
					}
				}
			}
		}
	}

	// Case 1: Tests are directly on the column (for structs).
	if tests, ok := colMap["tests"].([]interface{}); ok {
		columnKey := fmt.Sprintf("%s.%s", nodeKey, columnName)
		processTests(columnKey, columnName, tests)
	}

	// Case 2: Column is a struct with tests on its fields.
	if fields, ok := colMap["fields"].([]interface{}); ok {
		for _, fieldData := range fields {
			if fieldMap, ok := fieldData.(map[string]interface{}); ok {
				fieldName := getStringFromMap(fieldMap, "name", "")
				if fieldName == "" {
					continue
				}
				if tests, ok := fieldMap["tests"].([]interface{}); ok {
					columnKey := fmt.Sprintf("%s.%s", nodeKey, fieldName) // The key is based on the field name
					processTests(columnKey, fieldName, tests)
				}
			}
		}
	}
}

// convertDbtMetricsToWrenMetrics converts dbt metrics from semantic manifest to Wren MDL format
func convertDbtMetricsToWrenMetrics(semanticData map[string]interface{}) []Metric {
	var wrenMetrics []Metric
	measureToModelMap := make(map[string]string)
	measureDataLookup := make(map[string]map[string]interface{}) // measureName -> measureData

	// First, build lookup tables for all measures
	if semanticModels, ok := semanticData["semantic_models"].([]interface{}); ok {
		for _, sm := range semanticModels {
			if smMap, ok := sm.(map[string]interface{}); ok {
				modelName := getStringFromMap(smMap, "name", "")
				if modelName == "" {
					continue
				}
				if measures, ok := smMap["measures"].([]interface{}); ok {
					for _, m := range measures {
						if measureMap, ok := m.(map[string]interface{}); ok {
							measureName := getStringFromMap(measureMap, "name", "")
							if measureName != "" {
								measureToModelMap[measureName] = modelName
								measureDataLookup[measureName] = measureMap
							}
						}
					}
				}
			}
		}
	}

	// Now, iterate through the metrics and build Wren metrics
	if metrics, ok := semanticData["metrics"].([]interface{}); ok {
		for _, m := range metrics {
			if metricMap, ok := m.(map[string]interface{}); ok {
				metricName := getStringFromMap(metricMap, "name", "")
				metricLabel := getStringFromMap(metricMap, "label", metricName)
				metricDesc := getStringFromMap(metricMap, "description", "")
				metricType := getStringFromMap(metricMap, "type", "")

				wrenMetric := Metric{
					Name:        metricName,
					DisplayName: metricLabel,
					Description: metricDesc,
				}

				typeParams, _ := metricMap["type_params"].(map[string]interface{})

				// Find the underlying model and dimensions
				var baseModel string
				var timeDimensions []string
				if inputMeasuresValue, ok := typeParams["input_measures"]; ok {
					if inputMeasuresList, ok := inputMeasuresValue.([]interface{}); ok && len(inputMeasuresList) > 0 {
						// Find the model this metric is based on
						for _, inputMeasure := range inputMeasuresList {
							if imMap, ok := inputMeasure.(map[string]interface{}); ok {
								imName := getStringFromMap(imMap, "name", "")
								if model, exists := measureToModelMap[imName]; exists {
									baseModel = model
									break // Assume all measures for a metric come from the same model
								}
							}
						}
						if baseModel == "" {
							pterm.Warning.Printf("Could not find a parent model for metric '%s'\n", metricName)
						}
					}
				}

				// Find time dimensions from the semantic model
				if baseModel != "" {
					wrenMetric.Models = []string{baseModel}
					if semanticModels, ok := semanticData["semantic_models"].([]interface{}); ok {
						for _, sm := range semanticModels {
							if smMap, ok := sm.(map[string]interface{}); ok {
								if getStringFromMap(smMap, "name", "") == baseModel {
									if dims, ok := smMap["dimensions"].([]interface{}); ok {
										for _, d := range dims {
											if dimMap, ok := d.(map[string]interface{}); ok {
												if getStringFromMap(dimMap, "type", "") == "time" {
													timeDimensions = append(timeDimensions, getStringFromMap(dimMap, "name", ""))
												}
											}
										}
									}
								}
							}
						}
					}
					wrenMetric.Dimensions = timeDimensions
				}

				// Build the aggregation expression
				switch metricType {
				case "simple":
					if measure, ok := typeParams["measure"].(map[string]interface{}); ok {
						measureName := getStringFromMap(measure, "name", "")
						if measureData, ok := measureDataLookup[measureName]; ok {
							agg := getStringFromMap(measureData, "agg", "sum")
							expr := getStringFromMap(measureData, "expr", measureName)
							wrenMetric.Aggregation = fmt.Sprintf("%s(%s)", strings.ToUpper(agg), expr)
						}
					}
				case "ratio":
					if num, ok := typeParams["numerator"].(map[string]interface{}); ok {
						if den, ok := typeParams["denominator"].(map[string]interface{}); ok {
							numName := getStringFromMap(num, "name", "")
							denName := getStringFromMap(den, "name", "")
							if numData, ok := measureDataLookup[numName]; ok {
								if denData, ok := measureDataLookup[denName]; ok {
									numAgg := strings.ToUpper(getStringFromMap(numData, "agg", "sum"))
									denAgg := strings.ToUpper(getStringFromMap(denData, "agg", "sum"))
									numExpr := getStringFromMap(numData, "expr", numName)
									denExpr := getStringFromMap(denData, "expr", denName)
									wrenMetric.Aggregation = fmt.Sprintf("(%s(%s)) / (%s(%s))", numAgg, numExpr, denAgg, denExpr)
								}
							}
						}
					}
				case "derived":
					wrenMetric.Aggregation = getStringFromMap(typeParams, "expr", "")
				}

				if wrenMetric.Aggregation != "" && len(wrenMetric.Models) > 0 {
					wrenMetrics = append(wrenMetrics, wrenMetric)
				}
			}
		}
	}

	return wrenMetrics
}

// convertDbtNodeToWrenModel converts a single dbt node to Wren model
func convertDbtNodeToWrenModel(nodeKey string, nodeData map[string]interface{}, dataSource DataSource, manifestData map[string]interface{}, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool, modelToPrimaryKeyMap map[string]string) (*WrenModel, error) {
	// Extract model name from node key
	modelName := getModelNameFromNodeKey(nodeKey)
	if modelName == "" {
		return nil, fmt.Errorf("invalid node key format: %s", nodeKey)
	}

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

	// Extract descriptions from manifest.json if available
	var modelDescription string
	var columnDescriptions map[string]string

	if manifestData != nil {
		if nodes, ok := manifestData["nodes"].(map[string]interface{}); ok {
			if manifestNode, ok := nodes[nodeKey].(map[string]interface{}); ok {
				// Extract model description
				modelDescription = getStringFromMap(manifestNode, "description", "")

				// Extract column descriptions
				if manifestColumns, ok := manifestNode["columns"].(map[string]interface{}); ok {
					columnDescriptions = make(map[string]string)
					for colName, colData := range manifestColumns {
						if colMap, ok := colData.(map[string]interface{}); ok {
							description := getStringFromMap(colMap, "description", "")
							if description != "" {
								columnDescriptions[colName] = description
							}
						}
					}
				}
			}
		}
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

		columnName := getStringFromMap(colMap, "name", "")
		columnKey := fmt.Sprintf("%s.%s", nodeKey, columnName)

		column := WrenColumn{
			Name:        columnName,
			DisplayName: getStringFromMap(getMapFromMap(colMap, "meta", nil), "label", ""),
			Type:        dataSource.MapType(getStringFromMap(colMap, "type", "")),
			NotNull:     columnToNotNullMap[columnKey], // Will be false if not found
		}

		// Check for and assign enum
		if enumName, ok := columnToEnumNameMap[columnKey]; ok {
			column.Enum = enumName
		}

		// Initialize properties map if needed
		if column.Properties == nil {
			column.Properties = make(map[string]string)
		}

		// Set description from manifest if available
		if columnDescriptions != nil {
			if description, exists := columnDescriptions[column.Name]; exists && description != "" {
				column.Properties["description"] = description
			}
		}

		// Set notNull based on comment or other indicators
		if comment := getStringFromMap(colMap, "comment", ""); comment != "" {
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

	// Set primary key from semantic manifest if available
	if pk, ok := modelToPrimaryKeyMap[modelName]; ok {
		model.PrimaryKey = pk
	}

	// Set model description from manifest if available
	if modelDescription != "" {
		if model.Properties == nil {
			model.Properties = make(map[string]string)
		}
		model.Properties["description"] = modelDescription
	}

	return model, nil
}

// getStringFromMap safely extracts a string value from a map
func getStringFromMap(m map[string]interface{}, key, defaultValue string) string {
	if m == nil {
		return defaultValue
	}
	if value, exists := m[key]; exists {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return defaultValue
}

// getMapFromMap safely extracts a map value from a map
func getMapFromMap(m map[string]interface{}, key string, defaultValue map[string]interface{}) map[string]interface{} {
	if value, exists := m[key]; exists {
		if str, ok := value.(map[string]interface{}); ok {
			return str
		}
	}
	return defaultValue
}

// getModelNameFromNodeKey extracts the model name from a dbt node key.
// e.g., "model.jaffle_shop.customers" -> "customers"
func getModelNameFromNodeKey(nodeKey string) string {
	parts := strings.Split(nodeKey, ".")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return ""
}

var refRegex = regexp.MustCompile(`ref\s*\(\s*['"]([^'"]+)['"]\s*\)`)

// parseRef extracts the model name from a dbt ref string.
// e.g., "ref('stg_orders')"
func parseRef(refStr string) string {
	// Use the precompiled regex to find matches.
	matches := refRegex.FindStringSubmatch(refStr)
	if len(matches) > 1 {
		// The first submatch (index 1) is the captured group,
		// which is the model name we want.
		return matches[1]
	}
	return ""
}
