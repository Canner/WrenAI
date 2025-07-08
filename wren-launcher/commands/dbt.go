package commands

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"

	"github.com/Canner/WrenAI/wren-launcher/commands/dbt"
	"github.com/pterm/pterm"
)

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

	// Check if the provided path exists and is a directory
	if !dbt.IsDbtProjectValid(opts.ProjectPath) {
		pterm.Error.Printf("Error: Invalid dbt project path: %s\n", opts.ProjectPath)
		os.Exit(1)
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(opts.OutputDir, 0755); err != nil {
		pterm.Error.Printf("Error: Failed to create output directory: %v\n", err)
		os.Exit(1)
	}

	pterm.Info.Printf("Processing dbt project at: %s\n", opts.ProjectPath)
	pterm.Info.Printf("Output directory: %s\n", opts.OutputDir)

	// 1. Search for profiles.yml
	var profilesPath string
	var err error

	// First try to find profiles.yml in the project directory or common locations
	profilesPath, err = dbt.FindProfilesFile(opts.ProjectPath)
	if err != nil {
		pterm.Warning.Printf("Warning: Could not find profiles.yml: %v\n", err)
		pterm.Info.Println("Skipping data source conversion...")
	}

	// 2. Search for catalog.json and manifest.json in target directory
	targetDir := filepath.Join(opts.ProjectPath, "target")
	catalogPath := filepath.Join(targetDir, "catalog.json")
	manifestPath := filepath.Join(targetDir, "manifest.json")

	if !dbt.FileExists(catalogPath) {
		pterm.Error.Printf("Error: catalog.json not found at: %s\n", catalogPath)
		pterm.Info.Println("Hint: Run 'dbt docs generate' to create catalog.json")
		os.Exit(1)
	}

	// Check for manifest.json (optional but recommended for descriptions)
	var manifestExists bool
	if dbt.FileExists(manifestPath) {
		pterm.Info.Printf("Found manifest.json at: %s\n", manifestPath)
		manifestExists = true
	} else {
		pterm.Warning.Printf("Warning: manifest.json not found at: %s\n", manifestPath)
		pterm.Info.Println("Model and column descriptions will not be included")
	}
	// 3. Convert profiles.yml to WrenDataSource (if profiles found)
	var dataSourceGenerated bool
	var ds dbt.DataSource
	if profilesPath != "" {
		pterm.Info.Printf("Found profiles.yml at: %s\n", profilesPath)

		// Analyze profiles
		profiles, err := dbt.AnalyzeDbtProfiles(profilesPath)
		if err != nil {
			pterm.Error.Printf("Error: Failed to analyze profiles: %v\n", err)
			os.Exit(1)
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
			pterm.Error.Printf("Error: Failed to get data sources: %v\n", err)
			os.Exit(1)
		}

		if len(dataSources) == 0 {
			pterm.Warning.Println("Warning: No active data sources found")
			dataSourceGenerated = false
		} else {
			// Create WrenDataSource JSON
			var wrenDataSource map[string]interface{}

			// For simplicity, we'll use the first data source
			// In a more sophisticated implementation, you might want to handle multiple data sources
			ds := dataSources[0]

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
				pterm.Error.Printf("Error: Failed to marshal data source JSON: %v\n", err)
				os.Exit(1)
			}

			if err := os.WriteFile(dataSourcePath, dataSourceJSON, 0644); err != nil {
				pterm.Error.Printf("Error: Failed to write data source file: %v\n", err)
				os.Exit(1)
			}

			pterm.Success.Printf("✓ WrenDataSource saved to: %s\n", dataSourcePath)
			dataSourceGenerated = true
		}
	}

	// 4. Convert catalog.json to Wren MDL
	pterm.Info.Printf("Converting catalog.json from: %s\n", catalogPath)

	var manifestPathForConversion string
	if manifestExists {
		manifestPathForConversion = manifestPath
	}

	// Create a default data source if none was found
	if ds == nil {
		ds = &dbt.DefaultDataSource{}
	}

	manifest, err := dbt.ConvertDbtCatalogToWrenMDL(catalogPath, ds, manifestPathForConversion)
	if err != nil {
		pterm.Error.Printf("Error: Failed to convert catalog: %v\n", err)
		os.Exit(1)
	}

	// Write Wren MDL JSON
	mdlPath := filepath.Join(opts.OutputDir, "wren-mdl.json")
	mdlJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		pterm.Error.Printf("Error: Failed to marshal MDL JSON: %v\n", err)
		os.Exit(1)
	}

	if err := os.WriteFile(mdlPath, mdlJSON, 0644); err != nil {
		pterm.Error.Printf("Error: Failed to write MDL file: %v\n", err)
		os.Exit(1)
	}

	pterm.Success.Printf("✓ Wren MDL saved to: %s\n", mdlPath)

	// Summary
	pterm.Success.Println("\n🎉 Conversion completed successfully!")
	pterm.Info.Printf("Models converted: %d\n", len(manifest.Models))

	if profilesPath != "" && dataSourceGenerated {
		pterm.Info.Println("Generated files:")
		pterm.Info.Printf("  - WrenDataSource: %s\n", filepath.Join(opts.OutputDir, "wren-datasource.json"))
		pterm.Info.Printf("  - Wren MDL: %s\n", filepath.Join(opts.OutputDir, "wren-mdl.json"))
	} else if profilesPath != "" {
		pterm.Info.Println("Generated files:")
		pterm.Info.Printf("  - Wren MDL: %s\n", filepath.Join(opts.OutputDir, "wren-mdl.json"))
		pterm.Warning.Println("  - WrenDataSource: Not generated (no compatible data sources found)")
	} else {
		pterm.Info.Println("Generated files:")
		pterm.Info.Printf("  - Wren MDL: %s\n", filepath.Join(opts.OutputDir, "wren-mdl.json"))
		pterm.Warning.Println("  - WrenDataSource: Not generated (profiles.yml not found)")
	}
}
