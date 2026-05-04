package main

import (
	"flag"
	"os"

	"github.com/Canner/WrenAI/wren-launcher/commands"
	"github.com/Canner/WrenAI/wren-launcher/config"
	"github.com/pterm/pterm"
)

func main() {
	config.InitFlags()

	// Check if we have subcommands
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "dbt-auto-convert":
			// Remove the subcommand from args so flag.Parse() works correctly
			os.Args = append([]string{os.Args[0]}, os.Args[2:]...)
			commands.DbtAutoConvert()
			return
		case "help", "-h", "--help":
			showHelp()
			return
		}
	}

	// help flag
	help := flag.Bool("h", false, "Display help")
	flag.Parse()

	if *help {
		showHelp()
		return
	}

	commands.Launch()
}

func showHelp() {
	pterm.Info.Println("Usage of Wren launcher:")
	pterm.Info.Println("")
	pterm.Info.Println("Commands:")
	pterm.Info.Println("  (default)                                        Launch Wren AI service")
	pterm.Info.Println("  dbt-auto-convert --path --output [--profile] [--target]    Auto-convert dbt project to WrenDataSource and Wren MDL")
	pterm.Info.Println("")
	pterm.Info.Println("Flags:")
	flag.PrintDefaults()
	pterm.Info.Println("")
	pterm.Info.Println("Examples:")
	pterm.Info.Println("  wren-launcher                                              # Launch Wren AI")
	pterm.Info.Println("  wren-launcher dbt-auto-convert --path /path/to/dbt --output ./output    # Auto-convert dbt project")
	pterm.Info.Println("  wren-launcher dbt-auto-convert --path /path/to/dbt --output ./output --profile my_profile --target dev # Convert with specific profile/target")
}
