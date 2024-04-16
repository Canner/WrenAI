// the wrenrc.go package is responsible for writing and reading rcfile
// the rc file should located in ~/.wrenai/.wrenrc
// should have  public methods "append" and "read"(read by key or all)
// the structure of the rcfile is a env like file with key value pairs,
// eg:
//   "foo=bar"
//   "bar=baz"

package utils

import (
	"bufio"
	"fmt"
	"os"
	"path"
	"strings"
)

type WrenRC struct {
	rcFileDir string
}

func (w *WrenRC) getWrenRcFilePath() string {
	return path.Join(w.rcFileDir, ".wrenrc")
}

func (w *WrenRC) ensureRcFile() (string, error) {
	// ensure folder created
	err := os.MkdirAll(w.rcFileDir, os.ModePerm)
	if err != nil {
		return "", err
	}

	// ensure file created
	rcFilePath := w.getWrenRcFilePath()
	_, err = os.Stat(rcFilePath)
	if os.IsNotExist(err) {
		f, err := os.Create(rcFilePath)
		if err != nil {
			return "", err
		}
		f.Close()
	}
	return rcFilePath, nil
}

func (w *WrenRC) parseInto() (map[string]string, error) {
	rcFilePath, err := w.ensureRcFile()
	if err != nil {
		return nil, err
	}

	f, err := os.Open(rcFilePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// prepare a map to store the key value pairs
	m := make(map[string]string)
	// read the file line by line
	r := bufio.NewReader(f)
	lineno := 0
	for {
		// read the line
		line, err := r.ReadString('\n')
		if err != nil {
			if err.Error() != "EOF" {
				return nil, err // return an error if it's not EOF
			}
			break
		}
		lineno++
		line = strings.Trim(line, " \t\v\r\n")

		// Skip empty lines and comments
		if line == "" || line[0] == '#' || line[0] == ';' {
			continue
		}

		// Split the line into key and value based on the '=' character
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("syntax error on line %d: no '=' character found", lineno)
		}

		// Trim spaces around key and value
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])

		// Store the key-value pair in the map
		m[key] = value
	}

	return m, nil
}

// set a key value pair to the rc file
func (w *WrenRC) Set(key string, value string, override bool) error {
	// get the parsed key value pairs
	m, err := w.parseInto()
	if err != nil {
		return err
	}

	// put the new key value pair in the map
	_, ok := m[key]
	if ok && !override {
		// simply return without error
		return nil
	}
	m[key] = value

	// open the rc file for writing
	err = w.write(m)
	if err != nil {
		return err
	}

	return nil
}

// overrite the rc file with the given key value pairs
func (w *WrenRC) write(m map[string]string) error {
	rcFilePath := w.getWrenRcFilePath()
	f, err := os.Create(rcFilePath)
	if err != nil {
		return err
	}
	defer f.Close()

	for k, v := range m {
		_, err = fmt.Fprintf(f, "%s=%s\n", k, v)
		if err != nil {
			return err
		}
	}

	return nil
}

// read the value of a key from the rc file
func (w *WrenRC) Read(key string) (string, error) {
	m, err := w.parseInto()
	if err != nil {
		return "", err
	}

	v, ok := m[key]
	if !ok {
		return "", nil
	}

	return v, nil
}
