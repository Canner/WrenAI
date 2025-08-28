package commands

import (
	"flag"
	"os"

	"github.com/Canner/WrenAI/wren-launcher/commands/dbt"
	"github.com/pterm/pterm"
)

// DbtAutoConvert automatically searches for dbt profiles and catalog.json,
// then converts them to WrenDataSource and Wren MDL format
func DbtAutoConvert() {
	var opts struct {
		ProjectPath          string
		OutputDir            string
		ProfileName          string
		Target               string
		IncludeStagingModels bool
	}

	// Define command line flags
	flag.StringVar(&opts.ProjectPath, "path", "", "Path to the dbt project root directory")
	flag.StringVar(&opts.OutputDir, "output", "", "Output directory for generated JSON files")
	flag.StringVar(&opts.ProfileName, "profile", "", "Specific profile name to use (optional, uses first found if not provided)")
	flag.StringVar(&opts.Target, "target", "", "Specific target to use (optional, uses profile default if not provided)")
	flag.BoolVar(&opts.IncludeStagingModels, "include-staging-models", false, "If set, staging models will be included during conversion")
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
	convertOpts := dbt.ConvertOptions{
		ProjectPath:          opts.ProjectPath,
		OutputDir:            opts.OutputDir,
		ProfileName:          opts.ProfileName,
		Target:               opts.Target,
		RequireCatalog:       true, // DbtAutoConvert requires catalog.json to exist
		IncludeStagingModels: opts.IncludeStagingModels,
	}

	// Call the core conversion logic
	_, err := dbt.ConvertDbtProjectCore(convertOpts)
	if err != nil {
		pterm.Error.Printf("Error: Conversion failed: %v\n", err)
		os.Exit(1)
	}
}

// DbtConvertProject is a public wrapper function for processDbtProject to use
// It converts a dbt project without requiring catalog.json to exist
func DbtConvertProject(projectPath, outputDir, profileName, target string, usedByContainer bool, IncludeStagingModels bool) (*dbt.ConvertResult, error) {
	convertOpts := dbt.ConvertOptions{
		ProjectPath:          projectPath,
		OutputDir:            outputDir,
		ProfileName:          profileName,
		Target:               target,
		RequireCatalog:       false, // Allow processDbtProject to continue without catalog.json
		UsedByContainer:      usedByContainer,
		IncludeStagingModels: IncludeStagingModels,
	}

	return dbt.ConvertDbtProjectCore(convertOpts)
}