package dbt

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pterm/pterm"
)

// ConvertOptions holds the options for dbt project conversion
type ConvertOptions struct {
	ProjectPath     string
	OutputDir       string
	ProfileName     string
	Target          string
	RequireCatalog  bool // if true, missing catalog.json is an error; if false, it's a warning
	UsedByContainer bool // if true, used by container, no need to print usage info
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

	// Search for catalog.json and manifest.json in target directory
	targetDir := filepath.Join(opts.ProjectPath, "target")
	catalogPath := filepath.Join(targetDir, "catalog.json")
	manifestPath := filepath.Join(targetDir, "manifest.json")

	if !FileExists(catalogPath) {
		if opts.RequireCatalog {
			return nil, fmt.Errorf("catalog.json not found at: %s. Hint: Run 'dbt docs generate' to create catalog.json", catalogPath)
		} else {
			pterm.Warning.Printf("Warning: catalog.json not found at: %s\n", catalogPath)
			pterm.Info.Println("Hint: Run 'dbt docs generate' to create catalog.json")
			return &ConvertResult{LocalStoragePath: "."}, nil
		}
	}

	// Check for manifest.json (optional but recommended for descriptions)
	var manifestPathForConversion string
	if FileExists(manifestPath) {
		pterm.Info.Printf("Found manifest.json at: %s\n", manifestPath)
		manifestPathForConversion = manifestPath
	} else {
		pterm.Warning.Printf("Warning: manifest.json not found at: %s\n", manifestPath)
		pterm.Info.Println("Model and column descriptions will not be included")
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

	manifest, err := ConvertDbtCatalogToWrenMDL(catalogPath, ds, manifestPathForConversion)
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
func ConvertDbtCatalogToWrenMDL(catalogPath string, data_source DataSource, manifestPath string) (*WrenMDLManifest, error) {
	// Read and parse the catalog.json file
	data, err := os.ReadFile(catalogPath) // #nosec G304 -- catalogPath is controlled by application
	if err != nil {
		return nil, fmt.Errorf("failed to read catalog file %s: %w", catalogPath, err)
	}

	var catalogData map[string]interface{}
	if err := json.Unmarshal(data, &catalogData); err != nil {
		return nil, fmt.Errorf("failed to parse catalog JSON: %w", err)
	}

	// Parse manifest.json for descriptions (optional)
	var manifestData map[string]interface{}
	if manifestPath != "" {
		pterm.Info.Printf("Reading manifest.json for descriptions from: %s\n", manifestPath)
		manifestBytes, err := os.ReadFile(manifestPath) // #nosec G304 -- manifestPath is controlled by application
		if err != nil {
			pterm.Warning.Printf("Warning: Failed to read manifest file %s: %v\n", manifestPath, err)
		} else {
			if err := json.Unmarshal(manifestBytes, &manifestData); err != nil {
				pterm.Warning.Printf("Warning: Failed to parse manifest JSON: %v\n", err)
			}
		}
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
		DataSources:   data_source.GetType(), // Default data source name
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

		model, err := convertDbtNodeToWrenModel(nodeKey, nodeMap, data_source, manifestData)
		if err != nil {
			pterm.Warning.Printf("Warning: Failed to convert model %s: %v\n", nodeKey, err)
			continue
		}

		manifest.Models = append(manifest.Models, *model)
	}

	return manifest, nil
}

// convertDbtNodeToWrenModel converts a single dbt node to Wren model
func convertDbtNodeToWrenModel(nodeKey string, nodeData map[string]interface{}, data_source DataSource, manifestData map[string]interface{}) (*WrenModel, error) {
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

		column := WrenColumn{
			Name: getStringFromMap(colMap, "name", ""),
			Type: data_source.MapType(getStringFromMap(colMap, "type", "")),
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
		// This is a basic implementation - you might need more sophisticated logic
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
	if value, exists := m[key]; exists {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return defaultValue
}
