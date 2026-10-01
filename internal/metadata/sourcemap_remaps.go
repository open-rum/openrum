package metadata

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	// remapSettleDelay lets a build finish uploading all of its artifacts
	// before one remap pass covers them together.
	remapSettleDelay = 15 * time.Second
	remapLease       = 5 * time.Minute
	remapMaxAttempts = 10
)

type RemapRequest struct {
	ID          uuid.UUID
	ProjectID   uuid.UUID
	Version     string
	Dist        string
	RequestedAt time.Time
	Attempts    int
}

type RemapRepository struct{ database *sql.DB }

func NewRemapRepository(database *sql.DB) *RemapRepository {
	return &RemapRepository{database: database}
}

// Queue records that a release build gained a ready artifact. A pending
// request for the same build is reused and its requested_at bumped, so a run
// already in progress leaves it pending for one more pass.
func (repository *RemapRepository) Queue(ctx context.Context, projectID uuid.UUID, version, dist string) error {
	_, err := repository.database.ExecContext(ctx,
		`INSERT INTO sourcemap_remap_requests (project_id, version, dist) VALUES ($1,$2,$3)
		 ON CONFLICT (project_id, version, dist) WHERE processed_at IS NULL
		 DO UPDATE SET requested_at=now()`, projectID, version, dist)
	return err
}

// Claim leases the oldest settled request. The lease lets several workers share
// the queue and recovers requests from a worker that stopped mid-run.
func (repository *RemapRepository) Claim(ctx context.Context) (RemapRequest, bool, error) {
	var request RemapRequest
	err := repository.database.QueryRowContext(ctx,
		`UPDATE sourcemap_remap_requests SET locked_until=now()+$1*interval '1 second', attempts=attempts+1
		 WHERE id=(
		   SELECT id FROM sourcemap_remap_requests
		   WHERE processed_at IS NULL AND requested_at<=now()-$2*interval '1 second'
		     AND (locked_until IS NULL OR locked_until<now())
		   ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
		 RETURNING id, project_id, version, dist, requested_at, attempts`,
		remapLease.Seconds(), remapSettleDelay.Seconds(),
	).Scan(&request.ID, &request.ProjectID, &request.Version, &request.Dist, &request.RequestedAt, &request.Attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return RemapRequest{}, false, nil
	}
	if err != nil {
		return RemapRequest{}, false, err
	}
	return request, true, nil
}

// Complete marks the request processed unless another upload bumped it during
// the run, in which case it is released for another pass.
func (repository *RemapRepository) Complete(ctx context.Context, request RemapRequest) error {
	result, err := repository.database.ExecContext(ctx,
		`UPDATE sourcemap_remap_requests SET processed_at=now(), locked_until=NULL, last_error=NULL
		 WHERE id=$1 AND requested_at=$2`, request.ID, request.RequestedAt)
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err == nil && affected == 0 {
		_, err = repository.database.ExecContext(ctx,
			`UPDATE sourcemap_remap_requests SET locked_until=NULL, attempts=0 WHERE id=$1`, request.ID)
		return err
	}
	// Processed rows are only history; keep a week for diagnosis.
	_, err = repository.database.ExecContext(ctx,
		`DELETE FROM sourcemap_remap_requests WHERE processed_at<now()-interval '7 days'`)
	return err
}

// Retry schedules another attempt after a transient failure, giving up after a
// bounded number of attempts so a permanently broken dependency cannot keep a
// request leased forever.
func (repository *RemapRepository) Retry(ctx context.Context, request RemapRequest, cause error, delay time.Duration) error {
	message := []rune(cause.Error())
	if len(message) > 512 {
		message = message[:512]
	}
	processed := request.Attempts >= remapMaxAttempts
	_, err := repository.database.ExecContext(ctx,
		`UPDATE sourcemap_remap_requests
		 SET locked_until=now()+$2*interval '1 second', last_error=$3, processed_at=CASE WHEN $4 THEN now() ELSE NULL END
		 WHERE id=$1`, request.ID, delay.Seconds(), string(message), processed)
	return err
}
