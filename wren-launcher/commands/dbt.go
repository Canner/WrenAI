package commands

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Canner/WrenAI/wren-launcher/commands/dbt"
	"github.com/pterm/pterm"
)

// ConvertOptions holds the options for dbt project conversion
type ConvertOptions struct {
	ProjectPath    string
	OutputDir      string
	ProfileName    string
	Target         string
	RequireCatalog bool // if true, missing catalog.json is an error; if false, it's a warning
}

// ConvertResult holds the result of dbt project conversion
type ConvertResult struct {
	LocalStoragePath    string
	DataSourceGenerated bool
	ModelsCount         int
}

// DbtAutoConvert automatically searches for dbt profiles and catalog.json,
// then converts them to WrenDataSource and Wren MDL format
func DbtAutoConvert() {
	var opts struct {
		ProjectPath string
		OutputDir   string
		ProfileName string
		Target      string
	}

	// Define command line flags
	flag.StringVar(&opts.ProjectPath, "path", "", "Path to the dbt project root directory")
	flag.StringVar(&opts.OutputDir, "output", "", "Output directory for generated JSON files")
	flag.StringVar(&opts.ProfileName, "profile", "", "Specific profile name to use (optional, uses first found if not provided)")
	flag.StringVar(&opts.Target, "target", "", "Specific target to use (optional, uses profile default if not provided)")
	flag.Parse()

	// Validate required parameters
	if opts.ProjectPath == "" {
		pterm.Error.Println("Error: --path parameter is required")
		pterm.Info.Println("Usage: wren-launcher dbt-auto-convert --path /path/to/dbt/project --output /path/to/output")
		os.Exit(1)
	}

	if opts.OutputDir == "" {
		pterm.Error.Println("Error: --output parameter is required")
		pterm.Info.Println("Usage: wren-launcher dbt-auto-convert --path /path/to/dbt/project --output /path/to/output")
		os.Exit(1)
	}

	// ConvertOptions struct for core conversion logic
	convertOpts := ConvertOptions{
		ProjectPath:    opts.ProjectPath,
		OutputDir:      opts.OutputDir,
		ProfileName:    opts.ProfileName,
		Target:         opts.Target,
		RequireCatalog: true, // DbtAutoConvert requires catalog.json to exist
	}

	// Call the core conversion logic
	_, err := convertDbtProjectCore(convertOpts)
	if err != nil {
		pterm.Error.Printf("Error: Conversion failed: %v\n", err)
		os.Exit(1)
	}
}

// convertDbtProjectCore contains the core logic for converting dbt projects
// This function is used by both DbtAutoConvert and processDbtProject
func convertDbtProjectCore(opts ConvertOptions) (*ConvertResult, error) {
	// Validate dbt project
	if !dbt.IsDbtProjectValid(opts.ProjectPath) {
		return nil, fmt.Errorf("invalid dbt project path: %s", opts.ProjectPath)
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(opts.OutputDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	pterm.Info.Printf("Processing dbt project at: %s\n", opts.ProjectPath)
	pterm.Info.Printf("Output directory: %s\n", opts.OutputDir)

	// Search for profiles.yml
	profilesPath, err := dbt.FindProfilesFile(opts.ProjectPath)
	if err != nil {
		pterm.Warning.Printf("Warning: Could not find profiles.yml: %v\n", err)
		pterm.Info.Println("Skipping data source conversion...")
	}

	// Search for catalog.json and manifest.json in target directory
	targetDir := filepath.Join(opts.ProjectPath, "target")
	catalogPath := filepath.Join(targetDir, "catalog.json")
	manifestPath := filepath.Join(targetDir, "manifest.json")

	if !dbt.FileExists(catalogPath) {
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
	if dbt.FileExists(manifestPath) {
		pterm.Info.Printf("Found manifest.json at: %s\n", manifestPath)
		manifestPathForConversion = manifestPath
	} else {
		pterm.Warning.Printf("Warning: manifest.json not found at: %s\n", manifestPath)
		pterm.Info.Println("Model and column descriptions will not be included")
	}

	// Convert profiles.yml to WrenDataSource (if profiles found)
	var dataSourceGenerated bool
	var ds dbt.DataSource
	localStoragePath := "." // default value

	if profilesPath != "" {
		pterm.Info.Printf("Found profiles.yml at: %s\n", profilesPath)

		// Analyze profiles
		profiles, err := dbt.AnalyzeDbtProfiles(profilesPath)
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
		dataSources, err := dbt.GetActiveDataSources(profiles, opts.ProjectPath, opts.ProfileName, opts.Target)
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
			if localFileDS, ok := dataSources[0].(*dbt.WrenLocalFileDataSource); ok {
				localStoragePath = localFileDS.Url
				pterm.Info.Printf("Found DuckDB data source, using local storage path: %s\n", localStoragePath)
			}

			// Create WrenDataSource JSON
			var wrenDataSource map[string]interface{}

			switch typedDS := ds.(type) {
			case *dbt.WrenPostgresDataSource:
				wrenDataSource = map[string]interface{}{
					"type": "postgres",
					"properties": map[string]interface{}{
						"host":     typedDS.Host,
						"port":     typedDS.Port,
						"database": typedDS.Database,
						"user":     typedDS.User,
						"password": typedDS.Password,
					},
				}
			case *dbt.WrenLocalFileDataSource:
				wrenDataSource = map[string]interface{}{
					"type": "local_file",
					"properties": map[string]interface{}{
						"url":    typedDS.Url,
						"format": typedDS.Format,
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

			if err := os.WriteFile(dataSourcePath, dataSourceJSON, 0644); err != nil {
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
		ds = &dbt.DefaultDataSource{}
	}

	manifest, err := dbt.ConvertDbtCatalogToWrenMDL(catalogPath, ds, manifestPathForConversion)
	if err != nil {
		return nil, fmt.Errorf("failed to convert catalog: %w", err)
	}

	// Write Wren MDL JSON
	mdlPath := filepath.Join(opts.OutputDir, "wren-mdl.json")
	mdlJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("failed to marshal MDL JSON: %w", err)
	}

	if err := os.WriteFile(mdlPath, mdlJSON, 0644); err != nil {
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

// DbtConvertProject is a public wrapper function for processDbtProject to use
// It converts a dbt project without requiring catalog.json to exist
func DbtConvertProject(projectPath, outputDir, profileName, target string) (*ConvertResult, error) {
	convertOpts := ConvertOptions{
		ProjectPath:    projectPath,
		OutputDir:      outputDir,
		ProfileName:    profileName,
		Target:         target,
		RequireCatalog: false, // Allow processDbtProject to continue without catalog.json
	}

	return convertDbtProjectCore(convertOpts)
}
