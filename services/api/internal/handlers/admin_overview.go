package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"openrum/internal/auth"
	"openrum/internal/httpx"
	"openrum/internal/metadata"
	"openrum/internal/storagepressure"
)

type adminOverviewRoles interface {
	RoleForUser(context.Context, uuid.UUID) (metadata.InstanceRole, error)
}

type adminOverviewSource interface {
	Snapshot(context.Context) adminOverviewResponse
}

type AdminOverviewHandler struct {
	members adminOverviewRoles
	source  adminOverviewSource
	logger  zerolog.Logger
}

type adminDependencyResponse struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Status    string `json:"status"`
	LatencyMS *int64 `json:"latencyMs"`
	Detail    string `json:"detail"`
}

type adminCapacityResponse struct {
	Status                  string   `json:"status"`
	Mode                    string   `json:"mode"`
	Pressure                string   `json:"pressure"`
	UsedBytes               *uint64  `json:"usedBytes"`
	FreeBytes               *uint64  `json:"freeBytes"`
	CapacityBytes           *uint64  `json:"capacityBytes"`
	UsedPercent             *float64 `json:"usedPercent"`
	AutomaticSamplingActive bool     `json:"automaticSamplingActive"`
	AutomaticSamplingRate   *float64 `json:"automaticSamplingRate"`
	IngestBlocked           bool     `json:"ingestBlocked"`
	ObservedAt              *string  `json:"observedAt"`
	Detail                  string   `json:"detail"`
}

type adminPipelineResponse struct {
	LatestEventAt *string               `json:"latestEventAt"`
	KafkaLag      *int64                `json:"kafkaLag"`
	FailedJobs    *int64                `json:"failedJobs"`
	Capacity      adminCapacityResponse `json:"capacity"`
}

type adminOverviewResponse struct {
	Version        string                    `json:"version"`
	Environment    string                    `json:"environment"`
	DeploymentMode string                    `json:"deploymentMode"`
	StartedAt      string                    `json:"startedAt"`
	UptimeSeconds  int64                     `json:"uptimeSeconds"`
	LastMigration  *string                   `json:"lastMigrationAt"`
	Dependencies   []adminDependencyResponse `json:"dependencies"`
	Pipeline       adminPipelineResponse     `json:"pipeline"`
}

type adminOverviewDatabase interface {
	PingContext(context.Context) error
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type adminOverviewRedis interface {
	Ping(context.Context) *redis.StatusCmd
}

type SQLAdminOverviewSource struct {
	postgres          adminOverviewDatabase
	clickHouse        adminOverviewDatabase
	redis             adminOverviewRedis
	version           string
	environment       string
	deploymentMode    string
	storageConfigured bool
	startedAt         time.Time
	now               func() time.Time
	pressure          interface {
		Snapshot() storagepressure.Snapshot
	}
}

func NewAdminOverviewHandler(members adminOverviewRoles, source adminOverviewSource, logger zerolog.Logger) *AdminOverviewHandler {
	return &AdminOverviewHandler{members: members, source: source, logger: logger}
}

func NewSQLAdminOverviewSource(
	postgres, clickHouse *sql.DB,
	redisClient *redis.Client,
	version, environment, deploymentMode string,
	storageConfigured bool,
	startedAt time.Time,
	pressure ...interface {
		Snapshot() storagepressure.Snapshot
	},
) *SQLAdminOverviewSource {
	source := &SQLAdminOverviewSource{
		postgres: postgres, clickHouse: clickHouse, redis: redisClient,
		version: version, environment: environment, deploymentMode: deploymentMode,
		storageConfigured: storageConfigured, startedAt: startedAt.UTC(), now: time.Now,
	}
	if len(pressure) > 0 {
		source.pressure = pressure[0]
	}
	return source
}

func (handler *AdminOverviewHandler) Get(writer http.ResponseWriter, request *http.Request) {
	principal, ok := httpx.PrincipalFromContext(request.Context())
	if !ok {
		httpx.WriteError(writer, request, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	role, err := handler.members.RoleForUser(request.Context(), principal.UserID)
	if err != nil || auth.AuthorizeInstance(role, auth.InstanceActionRead) != nil {
		if err == nil {
			err = metadata.ErrForbidden
		}
		writeControlPlaneError(writer, request, handler.logger, err)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
	defer cancel()
	writeJSON(writer, http.StatusOK, handler.source.Snapshot(ctx))
}

func (source *SQLAdminOverviewSource) Snapshot(ctx context.Context) adminOverviewResponse {
	now := source.now().UTC()
	response := adminOverviewResponse{
		Version: source.version, Environment: source.environment, DeploymentMode: source.deploymentMode,
		StartedAt: source.startedAt.Format(timeFormat), UptimeSeconds: max(0, int64(now.Sub(source.startedAt).Seconds())),
		Dependencies: []adminDependencyResponse{
			{ID: "api", Label: "API", Status: "healthy", Detail: "当前 API 实例可响应"},
			{ID: "postgres", Label: "PostgreSQL", Status: "checking", Detail: "正在检查元数据存储"},
			{ID: "clickhouse", Label: "ClickHouse", Status: "checking", Detail: "正在检查事件存储"},
			{ID: "redis", Label: "Redis", Status: "checking", Detail: "正在检查缓存与接入状态"},
			{ID: "kafka", Label: "Kafka", Status: "unknown", Detail: "消费延迟采集将在维护任务阶段接入"},
			{ID: "object-storage", Label: "对象存储", Status: "not_configured", Detail: "可选能力未启用；核心监控不受影响"},
			{ID: "worker", Label: "Worker", Status: "unknown", Detail: "Worker 心跳尚未接入"},
		},
		Pipeline: adminPipelineResponse{
			Capacity: adminCapacityResponse{Status: "unknown", Mode: "unknown", Pressure: "unknown", Detail: "容量暂时无法读取"},
		},
	}
	if source.storageConfigured {
		response.Dependencies[5].Status = "configured"
		response.Dependencies[5].Detail = "对象存储已由部署配置；凭证不会回显"
	}

	var wait sync.WaitGroup
	wait.Add(5)
	go func() {
		defer wait.Done()
		response.Dependencies[1] = pingDependency(ctx, source.postgres, "postgres", "PostgreSQL", "元数据存储可连接")
	}()
	go func() {
		defer wait.Done()
		response.Dependencies[2] = pingDependency(ctx, source.clickHouse, "clickhouse", "ClickHouse", "事件存储可连接")
	}()
	go func() {
		defer wait.Done()
		started := time.Now()
		err := source.redis.Ping(ctx).Err()
		latency := time.Since(started).Milliseconds()
		response.Dependencies[3].LatencyMS = &latency
		if err != nil {
			response.Dependencies[3].Status = "unhealthy"
			response.Dependencies[3].Detail = "缓存服务不可用，请检查 Redis"
			return
		}
		response.Dependencies[3].Status = "healthy"
		response.Dependencies[3].Detail = "缓存与接入状态可连接"
	}()
	go func() {
		defer wait.Done()
		var applied time.Time
		if err := source.postgres.QueryRowContext(ctx,
			"SELECT applied_at FROM openrum_schema_migrations ORDER BY version DESC LIMIT 1").Scan(&applied); err == nil {
			formatted := applied.UTC().Format(timeFormat)
			response.LastMigration = &formatted
		}
	}()
	go func() {
		defer wait.Done()
		var latest sql.NullTime
		if err := source.clickHouse.QueryRowContext(ctx, "SELECT maxOrNull(received_at) FROM rum_events").Scan(&latest); err == nil && latest.Valid {
			formatted := latest.Time.UTC().Format(timeFormat)
			response.Pipeline.LatestEventAt = &formatted
		}
		if source.pressure != nil {
			snapshot := source.pressure.Snapshot()
			if snapshot.CapacityBytes > 0 {
				used, free, total := snapshot.UsedBytes, snapshot.FreeBytes, snapshot.CapacityBytes
				usedPercent := (1 - snapshot.FreeRatio) * 100
				observedAt, rate := snapshot.ObservedAt.UTC().Format(timeFormat), snapshot.AutomaticSamplingRate
				if snapshot.IngestBlocked {
					rate = 0
				}
				status, detail := "available", "ClickHouse 节点磁盘容量"
				if !snapshot.ProbeSuccessful {
					status, detail = "unknown", "容量探测失败；展示最近一次成功结果"
				}
				response.Pipeline.Capacity = adminCapacityResponse{
					Status: status, Mode: snapshot.Mode, Pressure: snapshot.Level,
					UsedBytes: &used, FreeBytes: &free, CapacityBytes: &total, UsedPercent: &usedPercent,
					AutomaticSamplingActive: snapshot.AutomaticSamplingActive, AutomaticSamplingRate: &rate,
					IngestBlocked: snapshot.IngestBlocked,
					ObservedAt:    &observedAt, Detail: detail,
				}
			}
		} else {
			var total, free uint64
			if err := source.clickHouse.QueryRowContext(ctx,
				"SELECT sum(total_space), sum(free_space) FROM system.disks").Scan(&total, &free); err == nil && total > 0 && total >= free {
				used, usedPercent := total-free, float64(total-free)/float64(total)*100
				response.Pipeline.Capacity = adminCapacityResponse{
					Status: "available", Mode: "unknown", Pressure: "unknown", UsedBytes: &used, FreeBytes: &free,
					CapacityBytes: &total, UsedPercent: &usedPercent, Detail: "ClickHouse 节点磁盘容量",
				}
			}
		}
	}()
	wait.Wait()
	return response
}

func pingDependency(ctx context.Context, database adminOverviewDatabase, id, label, healthyDetail string) adminDependencyResponse {
	started := time.Now()
	err := database.PingContext(ctx)
	latency := time.Since(started).Milliseconds()
	result := adminDependencyResponse{ID: id, Label: label, Status: "healthy", LatencyMS: &latency, Detail: healthyDetail}
	if err != nil {
		result.Status = "unhealthy"
		result.Detail = label + " 不可连接，请检查服务状态与部署配置"
	}
	return result
}
