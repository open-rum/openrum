package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

var ErrConfigVersionConflict = errors.New("configuration version conflict")

type InstanceSetting struct {
	Namespace string
	Key       string
	Value     json.RawMessage
	Version   int64
	Source    string
	UpdatedBy *uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
}

type InstanceSettingRepository struct {
	database *sql.DB
}

func NewInstanceSettingRepository(database *sql.DB) *InstanceSettingRepository {
	return &InstanceSettingRepository{database: database}
}

func (repository *InstanceSettingRepository) List(ctx context.Context) ([]InstanceSetting, error) {
	rows, err := repository.database.QueryContext(ctx, `SELECT namespace,key,value_json,version,source,
		updated_by,created_at,updated_at FROM instance_settings ORDER BY namespace,key`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	settings := make([]InstanceSetting, 0)
	for rows.Next() {
		setting, err := scanInstanceSetting(rows)
		if err != nil {
			return nil, err
		}
		settings = append(settings, setting)
	}
	return settings, rows.Err()
}

func (repository *InstanceSettingRepository) Set(
	ctx context.Context,
	actorID uuid.UUID,
	namespace string,
	key string,
	value json.RawMessage,
	expectedVersion int64,
) (InstanceSetting, error) {
	if expectedVersion < 0 {
		return InstanceSetting{}, ErrConfigVersionConflict
	}
	if expectedVersion == 0 {
		setting, err := scanInstanceSetting(repository.database.QueryRowContext(ctx, `
			INSERT INTO instance_settings (namespace,key,value_json,updated_by)
			VALUES ($1,$2,$3,$4)
			RETURNING namespace,key,value_json,version,source,updated_by,created_at,updated_at`,
			namespace, key, string(value), actorID))
		if isUniqueViolation(err) {
			return InstanceSetting{}, ErrConfigVersionConflict
		}
		return setting, err
	}

	setting, err := scanInstanceSetting(repository.database.QueryRowContext(ctx, `
		UPDATE instance_settings
		SET value_json=$1,version=version+1,updated_by=$2,updated_at=now()
		WHERE namespace=$3 AND key=$4 AND version=$5
		RETURNING namespace,key,value_json,version,source,updated_by,created_at,updated_at`,
		string(value), actorID, namespace, key, expectedVersion))
	if errors.Is(err, sql.ErrNoRows) {
		return InstanceSetting{}, ErrConfigVersionConflict
	}
	return setting, err
}

type settingScanner interface {
	Scan(...any) error
}

func scanInstanceSetting(scanner settingScanner) (InstanceSetting, error) {
	var setting InstanceSetting
	var value []byte
	err := scanner.Scan(&setting.Namespace, &setting.Key, &value, &setting.Version, &setting.Source,
		&setting.UpdatedBy, &setting.CreatedAt, &setting.UpdatedAt)
	setting.Value = append(json.RawMessage(nil), value...)
	return setting, err
}

func isUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}
