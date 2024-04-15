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
	"log"
	"os"
	"strings"
)

type WrenRC struct {
	rcFileDir string
}

func ParseInto(w *WrenRC, baseName string) {
	f, filename := openFile(baseName)
	if f == nil {
		return
	}
	defer f.Close()

	r := bufio.NewReader(f)
	lineno := 0
	for {
		l, err := r.ReadString('\n')
		if err != nil {
			break
		}
		lineno++
		l = strings.Trim(l, " \t\v\r\n")

		if len(l) == 0 {
			continue
		}
		if l[0] == '#' || l[0] == ';' {
			continue
		}

		var i int
		var c rune
		for i, c = range l {
			if c == '=' {
				break
			}
		}

		if c != '=' {
			log.Fatalf("Syntax error in file '%s' on line %d: Expected key=value pair; got: '%s'", filename, lineno, l)
		}

		k := strings.Trim(l[0:i], " \t\v\r\n")
		v := strings.TrimLeft(l[i+1:], " \t\v\r\n")

		er := flagSet.Set(k, v)
		if er != nil {
			log.Fatal(er)
		}
	}
}

// append a key value pair to the rc file
func (w *WrenRC) Append(key string, value string) error {
	f, err := os.OpenFile(w.rcFileDir, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = f.WriteString(fmt.Sprintf("%s=%s\n", key, value))
	if err != nil {
		return err
	}

	return nil
}

func (w *WrenRC) Read(key string) (string, error) {
	return w.UserUUID, nil
}
