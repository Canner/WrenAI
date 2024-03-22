package cli

import (
	"errors"
	"fmt"
	"strings"

	"github.com/common-nighthawk/go-figure"
	"github.com/manifoldco/promptui"
)

func askForAPIKey() (string, error) {
	// let users know we're asking for an API key
	fmt.Println("Please provide your OpenAI API key")

	validate := func(input string) error {
		// check if input is a valid API key
		// OpenAI API keys are starting with "sk-"
		if !strings.HasPrefix(input, "sk-") {
			return errors.New("invalid API key")
		}
		return nil
	}

	prompt := promptui.Prompt{
		Label:    "OpenAI API key",
		Validate: validate,
		Mask:     '*',
	}

	result, err := prompt.Run()

	if err != nil {
		fmt.Printf("Prompt failed %v\n", err)
		return "", err
	}

	return result, nil
}

func main() {
	// print WrenAI header
	fmt.Println(strings.Repeat("=", 55))
	myFigure := figure.NewFigure("WrenAI", "", true)
	myFigure.Print()
	fmt.Println(strings.Repeat("=", 55))

	// ask for OpenAI API key
	apiKey, err := askForAPIKey()

	if err != nil {
		fmt.Println("Failed to get API key")
		return
	}

	fmt.Println("API key:", apiKey)

	fmt.Scanf("h")
}
