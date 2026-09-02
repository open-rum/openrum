package migrate

import (
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

type Migration struct {
	Version int64
	Name    string
	SQL     string
	Applied bool
}

func load(source fs.FS, directory string) ([]Migration, error) {
	return loadDirection(source, directory, ".up.sql")
}

func loadDown(source fs.FS, directory string) ([]Migration, error) {
	return loadDirection(source, directory, ".down.sql")
}

func loadDirection(source fs.FS, directory, suffix string) ([]Migration, error) {
	entries, err := fs.ReadDir(source, directory)
	if err != nil {
		return nil, err
	}
	migrations := make([]Migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), suffix) {
			continue
		}
		prefix, _, ok := strings.Cut(entry.Name(), "_")
		if !ok {
			return nil, fmt.Errorf("migration %q must start with a numeric version and underscore", entry.Name())
		}
		version, err := strconv.ParseInt(prefix, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse migration %q version: %w", entry.Name(), err)
		}
		contents, err := fs.ReadFile(source, directory+"/"+entry.Name())
		if err != nil {
			return nil, err
		}
		migrations = append(migrations, Migration{Version: version, Name: entry.Name(), SQL: strings.TrimSpace(string(contents))})
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].Version < migrations[j].Version })
	for index := 1; index < len(migrations); index++ {
		if migrations[index-1].Version == migrations[index].Version {
			return nil, fmt.Errorf("duplicate migration version %d", migrations[index].Version)
		}
	}
	return migrations, nil
}

func withApplied(migrations []Migration, applied map[int64]bool) []Migration {
	result := make([]Migration, len(migrations))
	copy(result, migrations)
	for index := range result {
		result[index].Applied = applied[result[index].Version]
	}
	return result
}
