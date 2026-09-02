package metadata

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

func translateConstraintError(err error) error {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return errors.Join(ErrConflict, err)
	}
	return err
}
