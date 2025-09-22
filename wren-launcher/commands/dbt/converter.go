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

// ConvertDbtCatalogToWrenMDL is the main function to convert a dbt catalog into a Wren MDL manifest.
// It orchestrates the reading of dbt artifacts and processes each dbt node to convert it into a Wren model.
func ConvertDbtCatalogToWrenMDL(catalogPath string, dataSource DataSource, manifestPath string, semanticManifestPath string, includeStagingModels bool) (*WrenMDLManifest, error) {
	// --- 1. Read and Parse All Necessary DBT Artifact Files ---

	// Read and unmarshal the primary catalog.json file.
	catalogBytes, err := os.ReadFile(filepath.Clean(catalogPath))
	if err != nil {
		return nil, fmt.Errorf("failed to read catalog file %s: %w", catalogPath, err)
	}
	var catalogData map[string]interface{}
	if err := json.Unmarshal(catalogBytes, &catalogData); err != nil {
		return nil, fmt.Errorf("failed to parse catalog JSON: %w", err)
	}

	// Read and unmarshal the manifest.json file, which contains rich metadata.
	var manifestData map[string]interface{}
	if manifestPath != "" {
		pterm.Info.Printf("Reading manifest.json for descriptions and relationships from: %s\n", manifestPath)
		manifestBytes, err := os.ReadFile(filepath.Clean(manifestPath)) // #nosec G304 -- manifestPath is controlled by application
		if err != nil {
			pterm.Warning.Printf("Could not read manifest file %s: %v. Descriptions and relationships will be missing.\n", manifestPath, err)
		} else if err := json.Unmarshal(manifestBytes, &manifestData); err != nil {
			pterm.Warning.Printf("Could not parse manifest file %s: %v. Descriptions and relationships will be missing.\n", manifestPath, err)
		}
	}

	// Read and unmarshal the semantic_manifest.json file for metrics and primary keys.
	var semanticManifestData map[string]interface{}
	if semanticManifestPath != "" {
		semanticBytes, err := os.ReadFile(filepath.Clean(semanticManifestPath))
		if err != nil {
			pterm.Warning.Printf("Could not read semantic_manifest.json: %v. Metrics and primary keys will be missing.\n", err)
		} else if err := json.Unmarshal(semanticBytes, &semanticManifestData); err != nil {
			pterm.Warning.Printf("Could not parse semantic_manifest.json: %v. Metrics and primary keys will be missing.\n", err)
		}
	}

	// --- 2. Initialize Wren Manifest and Pre-process Metadata ---

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

	// Create lookup maps to store pre-processed information for quick access.
	enumValueToNameMap := make(map[string]string)
	columnToEnumNameMap := make(map[string]string)
	columnToNotNullMap := make(map[string]bool)
	modelToPrimaryKeyMap := make(map[string]string)

	// Pre-process the manifest to extract test data (enums, not-null constraints).
	if manifestData != nil {
		preprocessManifestForTests(manifestData, &manifest.EnumDefinitions, enumValueToNameMap, columnToEnumNameMap, columnToNotNullMap)
	}

	// Pre-process the semantic manifest to extract primary key information.
	if semanticManifestData != nil {
		preprocessSemanticManifestForPrimaryKeys(semanticManifestData, modelToPrimaryKeyMap)
	}

	// --- 3. Convert dbt Nodes to Wren Models ---

	nodesValue, exists := catalogData["nodes"]
	if !exists {
		return nil, fmt.Errorf("no 'nodes' section found in catalog")
	}
	nodesMap, ok := nodesValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid 'nodes' format in catalog")
	}

	// Iterate through each node in the catalog and convert it to a Wren model.
	for nodeKey, nodeValue := range nodesMap {
		nodeMap, ok := nodeValue.(map[string]interface{})
		if !ok {
			continue
		}
		// We are only interested in nodes that represent dbt models.
		if !strings.HasPrefix(nodeKey, "model.") {
			continue
		}

		// Skip staging models if the user has opted to exclude them.
		modelName := getModelNameFromNodeKey(nodeKey)
		if !includeStagingModels && (strings.HasPrefix(modelName, "stg_") || strings.HasPrefix(modelName, "staging_")) {
			continue
		}

		// Perform the conversion for the single node.
		model, err := convertDbtNodeToWrenModel(nodeKey, nodeMap, dataSource, manifestData, columnToEnumNameMap, columnToNotNullMap, modelToPrimaryKeyMap)
		if err != nil {
			pterm.Warning.Printf("Failed to convert model %s: %v\n", nodeKey, err)
			continue
		}
		manifest.Models = append(manifest.Models, *model)
	}

	// --- 4. Generate Relationships and Metrics ---

	// Generate relationships between models based on the dbt manifest.
	if manifestData != nil {
		manifest.Relationships = generateRelationships(manifestData)
	}

	// Generate metrics from the semantic manifest.
	if semanticManifestData != nil {
		manifest.Metrics = convertDbtMetricsToWrenMetrics(semanticManifestData)
	}

	return manifest, nil
}

// preprocessManifestForTests extracts information from dbt tests (like 'not_null' and 'accepted_values')
// and populates maps that will be used later during model conversion.
func preprocessManifestForTests(manifestData map[string]interface{}, enums *[]EnumDefinition, enumValueToNameMap, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool) {
	nodes, ok := manifestData["nodes"].(map[string]interface{})
	if !ok {
		return
	}

	for nodeKey, nodeValue := range nodes {
		nodeMap, ok := nodeValue.(map[string]interface{})
		if !ok {
			continue
		}

		// Process tests defined directly on model columns.
		if strings.HasPrefix(nodeKey, "model.") {
			modelName := getModelNameFromNodeKey(nodeKey)
			if columns, ok := nodeMap["columns"].(map[string]interface{}); ok {
				for columnName, colData := range columns {
					if colMap, ok := colData.(map[string]interface{}); ok {
						processColumnForTests(nodeKey, modelName, columnName, colMap, enums, enumValueToNameMap, columnToEnumNameMap, columnToNotNullMap)
					}
				}
			}
		}

		// Process compiled test nodes which are separate entries in the manifest.
		if strings.HasPrefix(nodeKey, "test.") {
			testMeta, _ := nodeMap["test_metadata"].(map[string]interface{})
			testName := getStringFromMap(testMeta, "name", "")
			attachedNodeID := getStringFromMap(nodeMap, "attached_node", "")
			columnName := getStringFromMap(nodeMap, "column_name", "")

			if attachedNodeID != "" && columnName != "" {
				columnKey := fmt.Sprintf("%s.%s", attachedNodeID, columnName)
				modelName := getModelNameFromNodeKey(attachedNodeID)

				if testName == "not_null" {
					columnToNotNullMap[columnKey] = true
				}

				if testName == "accepted_values" {
					if kwargs, ok := testMeta["kwargs"].(map[string]interface{}); ok {
						if values, ok := kwargs["values"].([]interface{}); ok && len(values) > 0 {
							createOrLinkEnum(modelName, columnName, columnKey, values, enums, enumValueToNameMap, columnToEnumNameMap)
						}
					}
				}
			}
		}
	}
}

// preprocessSemanticManifestForPrimaryKeys extracts primary key information from the semantic manifest.
func preprocessSemanticManifestForPrimaryKeys(semanticData map[string]interface{}, modelToPrimaryKeyMap map[string]string) {
	semanticModels, ok := semanticData["semantic_models"].([]interface{})
	if !ok {
		return
	}

	for _, sm := range semanticModels {
		smMap, ok := sm.(map[string]interface{})
		if !ok {
			continue
		}

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
		key := r.Name + "|" + r.JoinType + "|" + r.Condition
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, r)
	}
	return unique
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

// createOrLinkEnum is a helper to de-duplicate and manage enum creation based on 'accepted_values' tests.
func createOrLinkEnum(modelName, columnName, columnKey string, values []interface{}, allEnums *[]EnumDefinition, enumValueToNameMap, columnToEnumNameMap map[string]string) {
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

// processColumnForTests finds tests in a column definition (including nested fields) and processes them.
func processColumnForTests(nodeKey, modelName, columnName string, colMap map[string]interface{}, allEnums *[]EnumDefinition, enumValueToNameMap, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool) {
	// Helper to handle the actual test processing for a given column/field
	processTests := func(currentColumnKey, currentColumnName string, tests []interface{}) {
		for _, test := range tests {
			// Handle not_null test (string format)
			if testStr, ok := test.(string); ok && testStr == "not_null" {
				columnToNotNullMap[currentColumnKey] = true
			}

			// Handle tests in map format (e.g., accepted_values)
			if testMap, ok := test.(map[string]interface{}); ok {
				if accepted, ok := testMap["accepted_values"].(map[string]interface{}); ok {
					if values, ok := accepted["values"].([]interface{}); ok && len(values) > 0 {
						createOrLinkEnum(modelName, currentColumnName, currentColumnKey, values, allEnums, enumValueToNameMap, columnToEnumNameMap)
					}
				}
			}
		}
	}

	// Case 1: Tests are directly on the column itself.
	if tests, ok := colMap["tests"].([]interface{}); ok {
		columnKey := fmt.Sprintf("%s.%s", nodeKey, columnName)
		processTests(columnKey, columnName, tests)
	}

	// Case 2: The column is a struct, and tests are on its fields.
	if fields, ok := colMap["fields"].([]interface{}); ok {
		for _, fieldData := range fields {
			if fieldMap, ok := fieldData.(map[string]interface{}); ok {
				fieldName := getStringFromMap(fieldMap, "name", "")
				if fieldName == "" {
					continue
				}
				if tests, ok := fieldMap["tests"].([]interface{}); ok {
					// The unique key for a field is based on the field name.
					columnKey := fmt.Sprintf("%s.%s", nodeKey, fieldName)
					processTests(columnKey, fieldName, tests)
				}
			}
		}
	}
}

// convertDbtMetricsToWrenMetrics converts dbt metrics from the semantic manifest into the Wren MDL format.
// It serves as the main entry point for metric conversion, orchestrating the creation of lookup tables
// and processing each metric definition.
func convertDbtMetricsToWrenMetrics(semanticData map[string]interface{}) []Metric {
	var wrenMetrics []Metric

	// --- 1. Pre-process semantic models to build fast lookup maps ---
	// These maps are essential for quickly finding the model a measure belongs to and its details.
	measureToModelMap, measureDataLookup := buildMeasureLookups(semanticData)

	// --- 2. Iterate through each metric and convert it ---
	metrics, ok := semanticData["metrics"].([]interface{})
	if !ok {
		// If there's no 'metrics' array, there's nothing to do.
		return wrenMetrics
	}

	for _, m := range metrics {
		metricMap, ok := m.(map[string]interface{})
		if !ok {
			continue // Skip if the item is not a valid map.
		}

		// --- 3. Extract basic metric information ---
		metricName := getStringFromMap(metricMap, "name", "")
		if metricName == "" {
			continue // A metric must have a name.
		}

		wrenMetric := Metric{
			Name:        metricName,
			DisplayName: getStringFromMap(metricMap, "label", metricName),
			Description: getStringFromMap(metricMap, "description", ""),
		}

		typeParams, _ := metricMap["type_params"].(map[string]interface{})

		// --- 4. Determine the base model and time dimensions for the metric ---
		baseModel := findBaseModelForMetric(typeParams, measureToModelMap)
		if baseModel == "" {
			pterm.Warning.Printf("Could not find a parent model for metric '%s'\n", metricName)
			continue // Skip metric if we can't associate it with a model.
		}

		wrenMetric.Models = []string{baseModel}
		wrenMetric.Dimensions = findTimeDimensionsForModel(semanticData, baseModel)

		// --- 5. Build the specific aggregation expression based on the metric type ---
		metricType := getStringFromMap(metricMap, "type", "")
		wrenMetric.Aggregation = buildAggregationExpression(metricType, typeParams, measureDataLookup)

		// --- 6. Final validation before adding to the list ---
		// A metric is only valid if it has a base model and a valid aggregation expression.
		if wrenMetric.Aggregation != "" && len(wrenMetric.Models) > 0 {
			wrenMetrics = append(wrenMetrics, wrenMetric)
		}
	}

	return wrenMetrics
}

// buildMeasureLookups preprocesses the semantic models to create two essential maps:
// 1. measureToModelMap: Maps a measure's name to the name of the model it belongs to.
// 2. measureDataLookup: Maps a measure's name to its full data map for easy access to properties like `agg` and `expr`.
func buildMeasureLookups(semanticData map[string]interface{}) (map[string]string, map[string]map[string]interface{}) {
	measureToModelMap := make(map[string]string)
	measureDataLookup := make(map[string]map[string]interface{})

	semanticModels, ok := semanticData["semantic_models"].([]interface{})
	if !ok {
		return measureToModelMap, measureDataLookup
	}

	for _, sm := range semanticModels {
		smMap, ok := sm.(map[string]interface{})
		if !ok {
			continue
		}

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
	return measureToModelMap, measureDataLookup
}

// findBaseModelForMetric identifies the underlying base model for a given metric
// by looking at its "input_measures".
func findBaseModelForMetric(typeParams map[string]interface{}, measureToModelMap map[string]string) string {
	inputMeasuresValue, ok := typeParams["input_measures"]
	if !ok {
		// Fallback for simple metrics that use "measure" instead of "input_measures"
		if measureValue, ok := typeParams["measure"]; ok {
			if measureMap, ok := measureValue.(map[string]interface{}); ok {
				measureName := getStringFromMap(measureMap, "name", "")
				if model, exists := measureToModelMap[measureName]; exists {
					return model
				}
			}
		}
		return ""
	}

	inputMeasuresList, ok := inputMeasuresValue.([]interface{})
	if !ok || len(inputMeasuresList) == 0 {
		return ""
	}

	// Assume all measures for a given metric come from the same base model.
	// We only need to find the first valid one.
	for _, inputMeasure := range inputMeasuresList {
		if imMap, ok := inputMeasure.(map[string]interface{}); ok {
			imName := getStringFromMap(imMap, "name", "")
			if model, exists := measureToModelMap[imName]; exists {
				return model // Return the first model we find.
			}
		}
	}
	return ""
}

// findTimeDimensionsForModel scans the semantic models to find all columns
// marked with type "time" for a specific model name.
func findTimeDimensionsForModel(semanticData map[string]interface{}, baseModelName string) []string {
	var timeDimensions []string
	semanticModels, ok := semanticData["semantic_models"].([]interface{})
	if !ok {
		return timeDimensions
	}

	for _, sm := range semanticModels {
		smMap, ok := sm.(map[string]interface{})
		if !ok {
			continue
		}

		if getStringFromMap(smMap, "name", "") == baseModelName {
			if dims, ok := smMap["dimensions"].([]interface{}); ok {
				for _, d := range dims {
					if dimMap, ok := d.(map[string]interface{}); ok {
						if getStringFromMap(dimMap, "type", "") == "time" {
							timeDimensions = append(timeDimensions, getStringFromMap(dimMap, "name", ""))
						}
					}
				}
			}
			break // Found the model, no need to continue looping.
		}
	}
	return timeDimensions
}

// buildAggregationExpression constructs the SQL aggregation string for a Wren metric
// based on its dbt type ('simple', 'ratio', or 'derived').
func buildAggregationExpression(metricType string, typeParams map[string]interface{}, measureDataLookup map[string]map[string]interface{}) string {
	switch metricType {
	case "simple":
		// A simple metric is a direct aggregation of one measure (e.g., SUM(revenue)).
		if measure, ok := typeParams["measure"].(map[string]interface{}); ok {
			measureName := getStringFromMap(measure, "name", "")
			if measureData, ok := measureDataLookup[measureName]; ok {
				agg := getStringFromMap(measureData, "agg", "sum")         // Default to SUM
				expr := getStringFromMap(measureData, "expr", measureName) // Fallback to measure name
				return fmt.Sprintf("%s(%s)", strings.ToUpper(agg), expr)
			}
		}
	case "ratio":
		// A ratio metric is a division of two measures (e.g., SUM(profit) / SUM(revenue)).
		num, numOK := typeParams["numerator"].(map[string]interface{})
		den, denOK := typeParams["denominator"].(map[string]interface{})
		if !numOK || !denOK {
			return ""
		}

		numName := getStringFromMap(num, "name", "")
		denName := getStringFromMap(den, "name", "")
		numData, numDataOK := measureDataLookup[numName]
		denData, denDataOK := measureDataLookup[denName]

		if numDataOK && denDataOK {
			numAgg := strings.ToUpper(getStringFromMap(numData, "agg", "sum"))
			denAgg := strings.ToUpper(getStringFromMap(denData, "agg", "sum"))
			numExpr := getStringFromMap(numData, "expr", numName)
			denExpr := getStringFromMap(denData, "expr", denName)
			return fmt.Sprintf("(%s(%s)) / (%s(%s))", numAgg, numExpr, denAgg, denExpr)
		}
	case "derived":
		// A derived metric uses a freeform SQL expression.
		return getStringFromMap(typeParams, "expr", "")
	}
	return "" // Return empty string if no valid aggregation could be built.
}

// extractDescriptionsFromManifest parses the manifest.json data to find the
// model-level description and a map of all column-level descriptions.
func extractDescriptionsFromManifest(manifestData map[string]interface{}, nodeKey string) (string, map[string]string) {
	if manifestData == nil {
		return "", nil
	}

	nodes, ok := manifestData["nodes"].(map[string]interface{})
	if !ok {
		return "", nil
	}

	manifestNode, ok := nodes[nodeKey].(map[string]interface{})
	if !ok {
		return "", nil
	}

	// Extract the top-level model description
	modelDescription := getStringFromMap(manifestNode, "description", "")
	columnDescriptions := make(map[string]string)

	manifestColumns, ok := manifestNode["columns"].(map[string]interface{})
	if !ok {
		// Return the model description even if columns aren't found
		return modelDescription, nil
	}

	// Iterate through columns to extract their descriptions
	for colName, colData := range manifestColumns {
		if colMap, ok := colData.(map[string]interface{}); ok {
			if description := getStringFromMap(colMap, "description", ""); description != "" {
				columnDescriptions[colName] = description
			}
		}
	}

	return modelDescription, columnDescriptions
}

// buildWrenColumn creates a single WrenColumn from its corresponding dbt column data map.
// It populates the name, type, and properties like enums, descriptions, and comments.
func buildWrenColumn(colMap map[string]interface{}, nodeKey string, dataSource DataSource, columnDescriptions map[string]string, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool) WrenColumn {
	columnName := getStringFromMap(colMap, "name", "")
	columnKey := fmt.Sprintf("%s.%s", nodeKey, columnName)

	column := WrenColumn{
		Name:        columnName,
		DisplayName: getStringFromMap(getMapFromMap(colMap, "meta", nil), "label", ""),
		Type:        dataSource.MapType(getStringFromMap(colMap, "type", "")),
		NotNull:     columnToNotNullMap[columnKey], // Defaults to false if not found
	}

	// Assign an enum if one was derived from dbt tests
	if enumName, ok := columnToEnumNameMap[columnKey]; ok {
		column.Enum = enumName
	}

	// Use a temporary map to build the properties
	properties := make(map[string]string)
	if description, exists := columnDescriptions[column.Name]; exists && description != "" {
		properties["description"] = description
	}
	if comment := getStringFromMap(colMap, "comment", ""); comment != "" {
		properties["comment"] = comment
	}

	// Assign the properties map only if it's not empty
	if len(properties) > 0 {
		column.Properties = properties
	}

	return column
}

// convertAndSortColumns extracts, sorts, and converts dbt columns to the WrenColumn format.
func convertAndSortColumns(nodeData map[string]interface{}, nodeKey string, dataSource DataSource, columnDescriptions map[string]string, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool) ([]WrenColumn, error) {
	columnsValue, exists := nodeData["columns"]
	if !exists {
		return nil, fmt.Errorf("no columns found for model %s", nodeKey)
	}

	columnsMap, ok := columnsValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid columns format for model %s", nodeKey)
	}

	// Convert map to a slice for sorting
	var columnsData []map[string]interface{}
	for _, colValue := range columnsMap {
		if colMap, ok := colValue.(map[string]interface{}); ok {
			columnsData = append(columnsData, colMap)
		}
	}

	// Sort columns by the 'index' field, falling back to name
	sort.Slice(columnsData, func(i, j int) bool {
		indexI, okI := columnsData[i]["index"].(float64)
		indexJ, okJ := columnsData[j]["index"].(float64)
		if okI && okJ {
			return indexI < indexJ
		}
		return getStringFromMap(columnsData[i], "name", "") < getStringFromMap(columnsData[j], "name", "")
	})

	// Build the final slice of WrenColumns
	var wrenColumns []WrenColumn
	for _, colMap := range columnsData {
		if getStringFromMap(colMap, "name", "") == "" {
			continue
		}
		column := buildWrenColumn(colMap, nodeKey, dataSource, columnDescriptions, columnToEnumNameMap, columnToNotNullMap)
		wrenColumns = append(wrenColumns, column)
	}

	return wrenColumns, nil
}

// convertDbtNodeToWrenModel converts a single dbt node to a Wren model.
// This function now orchestrates calls to helpers to perform the conversion.
func convertDbtNodeToWrenModel(nodeKey string, nodeData map[string]interface{}, dataSource DataSource, manifestData map[string]interface{}, columnToEnumNameMap map[string]string, columnToNotNullMap map[string]bool, modelToPrimaryKeyMap map[string]string) (*WrenModel, error) {
	modelName := getModelNameFromNodeKey(nodeKey)
	if modelName == "" {
		return nil, fmt.Errorf("invalid node key format: %s", nodeKey)
	}

	// --- 1. Extract Metadata and Table Reference ---
	metadataValue, exists := nodeData["metadata"]
	if !exists {
		return nil, fmt.Errorf("no metadata found for model %s", nodeKey)
	}
	metadata, ok := metadataValue.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid metadata format for model %s", nodeKey)
	}
	tableRef := TableReference{
		Table:   getStringFromMap(metadata, "name", modelName),
		Catalog: getStringFromMap(metadata, "database", ""),
		Schema:  getStringFromMap(metadata, "schema", ""),
	}

	// --- 2. Extract Descriptions from Manifest ---
	modelDescription, columnDescriptions := extractDescriptionsFromManifest(manifestData, nodeKey)

	// --- 3. Convert and Sort Columns ---
	wrenColumns, err := convertAndSortColumns(nodeData, nodeKey, dataSource, columnDescriptions, columnToEnumNameMap, columnToNotNullMap)
	if err != nil {
		return nil, err
	}

	// --- 4. Assemble the Final WrenModel ---
	model := &WrenModel{
		Name:           modelName,
		TableReference: tableRef,
		Columns:        wrenColumns,
	}

	// Set primary key if available
	if pk, ok := modelToPrimaryKeyMap[modelName]; ok {
		model.PrimaryKey = pk
	}

	// Set model description if available
	if modelDescription != "" {
		model.Properties = map[string]string{"description": modelDescription}
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
