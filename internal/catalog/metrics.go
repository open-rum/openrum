package catalog

// uniq merges a uniqCombined64 state that may be empty into a non-null count.
func uniq(column string) string {
	return "coalesce(uniqCombined64Merge(" + column + "), 0)"
}

// Every metric below reads an aggregate that already exists. None of them needs a new
// ClickHouse migration, which is also why some metrics people expect are absent:
//
//   - Web Vitals are stored as quantileTDigest(0.75) states on Nullable columns, which
//     ClickHouse 25.8 cannot merge at any other level. There is no LCP P50 or P95 here;
//     the Performance page reads raw Events for those.
//   - FCP and TTFB are not aggregated at all.
func init() {
	registerTraffic()
	registerVitals()
	registerAPI()
	registerIssues()
	registerMeasurements()
	registerBehavior()
}

func registerTraffic() {
	pageViewSamples := uniq("page_view_events")
	register(Metric{
		ID: "traffic.pageViews", Family: FamilyTraffic, Label: "PV", Description: "页面浏览次数（按采样率还原）",
		Source: SourceProject, Unit: UnitCount, Weighting: WeightingEstimated, Kind: KindCount, Direction: DirectionUp,
		Value: "sumMerge(page_view_estimated)", Samples: pageViewSamples,
		AdditiveOverTime: true, PartitionDims: allDimensions,
	})
	// Distinct users and Sessions are counted on page views only and are not scaled by
	// the sample rate. They are cardinalities: never summed across buckets or groups.
	register(Metric{
		ID: "traffic.uniqueUsers", Family: FamilyTraffic, Label: "UV", Description: "访问过站点的独立用户（近似）",
		Source: SourceProject, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindDistinct, Direction: DirectionUp,
		Value: uniq("unique_users"), Samples: pageViewSamples, Approximate: true,
	})
	register(Metric{
		ID: "traffic.sessions", Family: FamilyTraffic, Label: "会话数", Description: "发生过页面浏览的会话（近似）",
		Source: SourceProject, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindDistinct, Direction: DirectionUp,
		Value: uniq("unique_sessions"), Samples: pageViewSamples, Approximate: true,
	})
	// Every error Event, weighted. It will not equal issues.events, which counts only
	// errors that grouped into an Issue and is not scaled by the sample rate.
	register(Metric{
		ID: "traffic.errors", Family: FamilyTraffic, Label: "错误数", Description: "全部错误事件（按采样率还原）",
		Source: SourceProject, Unit: UnitCount, Weighting: WeightingEstimated, Kind: KindCount, Direction: DirectionDown,
		Semantic: "danger", Value: "sumMerge(error_estimated)", Samples: uniq("error_events"),
		AdditiveOverTime: true, PartitionDims: allDimensions,
	})
	register(Metric{
		ID: "traffic.apiRequests", Family: FamilyTraffic, Label: "API 请求数", Description: "全部 API 请求（按采样率还原）",
		Source: SourceProject, Unit: UnitCount, Weighting: WeightingEstimated, Kind: KindCount, Direction: DirectionNeutral,
		Value: "sumMerge(api_estimated)", Samples: uniq("api_requests"),
		AdditiveOverTime: true, PartitionDims: allDimensions,
	})
	// Errors per page view, matching the classic overview. It can exceed 100%.
	register(Metric{
		ID: "traffic.errorRate", Family: FamilyTraffic, Label: "错误率", Description: "错误事件数占页面浏览量的比例",
		Source: SourceProject, Unit: UnitRatio, Weighting: WeightingEstimated, Kind: KindRate, Direction: DirectionDown,
		Semantic: "danger", Numerator: "sumMerge(error_estimated)", Denominator: "sumMerge(page_view_estimated)",
		Samples: pageViewSamples,
	})
	register(Metric{
		ID: "traffic.apiFailureRate", Family: FamilyTraffic, Label: "API 失败率", Description: "失败请求占全部 API 请求的比例",
		Source: SourceProject, Unit: UnitRatio, Weighting: WeightingSampled, Kind: KindRate, Direction: DirectionDown,
		Semantic: "warning", Numerator: uniq("api_failures"), Denominator: uniq("api_requests"),
		Samples: uniq("api_requests"),
	})
}

func registerVitals() {
	vitals := []struct {
		id, label, description, column string
		unit                           Unit
		thresholds                     Thresholds
	}{
		{"vitals.lcpP75", "LCP P75", "主要内容加载耗时 · P75", "lcp", UnitMS, Thresholds{Good: 2500, Poor: 4000}},
		{"vitals.inpP75", "INP P75", "交互响应耗时 · P75", "inp", UnitMS, Thresholds{Good: 200, Poor: 500}},
		{"vitals.clsP75", "CLS P75", "页面布局偏移 · P75", "cls", UnitScore, Thresholds{Good: 0.1, Poor: 0.25}},
	}
	for _, vital := range vitals {
		thresholds := vital.thresholds
		register(Metric{
			ID: vital.id, Family: FamilyVitals, Label: vital.label, Description: vital.description,
			Source: SourceProject, Unit: vital.unit, Weighting: WeightingNone, Kind: KindQuantile, Direction: DirectionDown,
			Value:   "quantileTDigestMerge(0.75)(" + vital.column + "_p75)",
			Samples: uniq(vital.column + "_samples"), MinSamples: 50, Thresholds: &thresholds,
		})
	}
}

func registerAPI() {
	requests := uniq("requests")
	register(Metric{
		ID: "api.requests", Family: FamilyAPI, Label: "请求数", Description: "API 请求（按采样率还原）",
		Source: SourceAPI, Unit: UnitCount, Weighting: WeightingEstimated, Kind: KindCount, Direction: DirectionNeutral,
		Value: "sumMerge(estimated)", Samples: requests, AdditiveOverTime: true, PartitionDims: allDimensions,
	})
	// A failure is a network-level failure or a 5xx response. A 4xx is the server
	// answering and is deliberately not a failure, so failures ≈ serverErrors + networkErrors.
	register(Metric{
		ID: "api.failures", Family: FamilyAPI, Label: "失败请求数", Description: "网络失败或 5xx 响应（不含 4xx）",
		Source: SourceAPI, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindCount, Direction: DirectionDown,
		Value: uniq("failures"), Samples: requests, AdditiveOverTime: true, PartitionDims: allDimensions,
	})
	outcomes := []struct{ key, column, label, description string }{
		{"client", "client_errors", "4xx", "4xx 响应（不计入失败）"},
		{"server", "server_errors", "5xx", "5xx 响应"},
		{"network", "network_errors", "网络错误", "网络中断、超时或被取消"},
	}
	for _, outcome := range outcomes {
		register(Metric{
			ID: "api." + outcome.key + "Errors", Family: FamilyAPI, Label: outcome.label + " 数",
			Description: outcome.description, Source: SourceAPI, Unit: UnitCount, Weighting: WeightingSampled,
			Kind: KindCount, Direction: DirectionDown, Value: uniq(outcome.column), Samples: requests,
			AdditiveOverTime: true, PartitionDims: allDimensions, CompositionGroup: "api.outcomeCount",
		})
	}
	register(Metric{
		ID: "api.failureRate", Family: FamilyAPI, Label: "失败率", Description: "失败请求占全部请求的比例",
		Source: SourceAPI, Unit: UnitRatio, Weighting: WeightingSampled, Kind: KindRate, Direction: DirectionDown,
		Semantic: "warning", Numerator: uniq("failures"), Denominator: requests, Samples: requests,
	})
	// The three outcome shares have one denominator, so stacked they are honestly a share
	// of all requests — which is why the composition chart uses rates, not raw counts.
	for _, outcome := range outcomes {
		register(Metric{
			ID: "api." + outcome.key + "ErrorRate", Family: FamilyAPI, Label: outcome.label + " 占比",
			Description: outcome.description + "占全部请求的比例", Source: SourceAPI, Unit: UnitRatio,
			Weighting: WeightingSampled, Kind: KindRate, Direction: DirectionDown,
			Numerator: uniq(outcome.column), Denominator: requests, Samples: requests,
			CompositionGroup: "api.outcomeRate",
		})
	}
	for _, quantile := range []struct{ id, label, level, column string }{
		{"api.durationP50", "延迟 P50", "0.5", "duration_p50"},
		{"api.durationP75", "延迟 P75", "0.75", "duration_p75"},
		{"api.durationP95", "延迟 P95", "0.95", "duration_p95"},
	} {
		register(Metric{
			ID: quantile.id, Family: FamilyAPI, Label: quantile.label, Description: "API 请求耗时分位数",
			Source: SourceAPI, Unit: UnitMS, Weighting: WeightingNone, Kind: KindQuantile, Direction: DirectionDown,
			Value:   "quantileTDigestMerge(" + quantile.level + ")(" + quantile.column + ")",
			Samples: requests, MinSamples: 75,
		})
	}
}

func registerIssues() {
	events := uniq("events")
	register(Metric{
		ID: "issues.events", Family: FamilyIssues, Label: "错误事件数", Description: "归入 Issue 的错误事件（未按采样率还原）",
		Source: SourceIssue, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindCount, Direction: DirectionDown,
		Semantic: "danger", Value: events, Samples: events, AdditiveOverTime: true, PartitionDims: allDimensions,
	})
	register(Metric{
		ID: "issues.users", Family: FamilyIssues, Label: "受影响用户", Description: "遇到过错误的独立用户（近似）",
		Source: SourceIssue, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindDistinct, Direction: DirectionDown,
		Value: uniq("users"), Samples: events, Approximate: true,
	})
	register(Metric{
		ID: "issues.sessions", Family: FamilyIssues, Label: "受影响会话", Description: "发生过错误的会话（近似）",
		Source: SourceIssue, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindDistinct, Direction: DirectionDown,
		Value: uniq("sessions"), Samples: events, Approximate: true,
	})
	// Each fingerprint resolves to exactly one error type, so active Issues partition
	// across error types — but the same Issue appears in many buckets and browsers.
	register(Metric{
		ID: "issues.activeIssues", Family: FamilyIssues, Label: "活跃 Issue", Description: "时间范围内出现过的 Issue 数",
		Source: SourceIssue, Unit: UnitCount, Weighting: WeightingNone, Kind: KindDistinct, Direction: DirectionDown,
		Value: "uniqExact(fingerprint)", Samples: events, PartitionDims: []string{"errorType"},
	})
	register(Metric{
		ID: "issues.newIssues", Family: FamilyIssues, Label: "新增 Issue",
		Description: "时间范围内首次出现、或沉寂 30 天后复发的 Issue",
		Source:      SourceIssue, Unit: UnitCount, Weighting: WeightingNone, Kind: KindNewIssues, Direction: DirectionDown,
		// Each Issue has one first-seen instant, so new Issues add up over time. Newness is
		// defined per environment, so the only breakdown that keeps it meaningful is type.
		AdditiveOverTime: true, PartitionDims: []string{"errorType"}, Dimensions: []string{"errorType"},
	})
}

func registerMeasurements() {
	samples := "countMerge(samples)"
	// A property attribute is absent on Events that did not set it, so property rows do
	// not cover the whole population. Only the built-in dimensions partition it.
	register(Metric{
		ID: "measurement.estimated", Family: FamilyMeasurement, Label: "估算总和", Description: "按采样率还原后的总和",
		Source: SourceMeasurement, Unit: UnitNumber, Weighting: WeightingEstimated, Kind: KindCount, Direction: DirectionNeutral,
		Value: "sumMerge(estimated)", Samples: samples, AdditiveOverTime: true, PartitionDims: measurementDimensions,
	})
	register(Metric{
		ID: "measurement.sum", Family: FamilyMeasurement, Label: "总和", Description: "已入库数值的总和（未还原采样）",
		Source: SourceMeasurement, Unit: UnitNumber, Weighting: WeightingNone, Kind: KindCount, Direction: DirectionNeutral,
		Value: "sumMerge(total)", Samples: samples, AdditiveOverTime: true, PartitionDims: measurementDimensions,
	})
	register(Metric{
		ID: "measurement.samples", Family: FamilyMeasurement, Label: "样本数", Description: "带有该数值的事件数",
		Source: SourceMeasurement, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindCount, Direction: DirectionNeutral,
		Value: samples, Samples: samples, AdditiveOverTime: true, PartitionDims: measurementDimensions,
	})
	register(Metric{
		ID: "measurement.avg", Family: FamilyMeasurement, Label: "平均值", Description: "总和除以样本数",
		Source: SourceMeasurement, Unit: UnitNumber, Weighting: WeightingNone, Kind: KindMean, Direction: DirectionNeutral,
		Numerator: "sumMerge(total)", Denominator: "toFloat64(countMerge(samples))", Samples: samples,
	})
	register(Metric{
		ID: "measurement.min", Family: FamilyMeasurement, Label: "最小值", Description: "时间范围内的最小值",
		Source: SourceMeasurement, Unit: UnitNumber, Weighting: WeightingNone, Kind: KindExtremum, Direction: DirectionNeutral,
		Value: "minMerge(minimum)", Samples: samples,
	})
	register(Metric{
		ID: "measurement.max", Family: FamilyMeasurement, Label: "最大值", Description: "时间范围内的最大值",
		Source: SourceMeasurement, Unit: UnitNumber, Weighting: WeightingNone, Kind: KindExtremum, Direction: DirectionNeutral,
		Value: "maxMerge(maximum)", Samples: samples,
	})
	// The digest stores centroids at single precision; converting on the server avoids a
	// Float32 scan and keeps both quantiles on one merge, which ClickHouse evaluates once.
	for _, quantile := range []struct{ id, label, index string }{
		{"measurement.p50", "中位数 P50", "1"},
		{"measurement.p90", "P90", "2"},
	} {
		register(Metric{
			ID: quantile.id, Family: FamilyMeasurement, Label: quantile.label, Description: "数值分位数（单精度近似）",
			Source: SourceMeasurement, Unit: UnitNumber, Weighting: WeightingNone, Kind: KindQuantile, Direction: DirectionNeutral,
			Value:   "toFloat64(quantilesTDigestMerge(0.5, 0.9)(quantiles)[" + quantile.index + "])",
			Samples: samples, MinSamples: 50, Approximate: true,
		})
	}
}

// Behavior metrics read the 0006 rollup, which keeps every page view, route change, click
// and Custom Event by kind and name. Split by event name they answer "how often did each of
// these happen" — payment started, succeeded and failed as three lines on one axis.
func registerBehavior() {
	events := uniq("events")
	// Each Event has exactly one name and one value per built-in dimension, so counts add
	// up across all of them. A property row exists only where the attribute was set.
	partitions := append([]string{"eventName"}, behaviorRowDimensions...)
	register(Metric{
		ID: "behavior.events", Family: FamilyBehavior, Label: "事件次数", Description: "行为事件发生次数（按采样率还原）",
		Source: SourceBehavior, Unit: UnitCount, Weighting: WeightingEstimated, Kind: KindCount, Direction: DirectionNeutral,
		Value: "sumMerge(estimated)", Samples: events, AdditiveOverTime: true, PartitionDims: partitions,
	})
	register(Metric{
		ID: "behavior.users", Family: FamilyBehavior, Label: "触发用户数", Description: "触发过事件的独立用户（近似）",
		Source: SourceBehavior, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindDistinct, Direction: DirectionNeutral,
		Value: uniq("unique_users"), Samples: events, Approximate: true,
	})
	register(Metric{
		ID: "behavior.sessions", Family: FamilyBehavior, Label: "触发会话数", Description: "触发过事件的会话（近似）",
		Source: SourceBehavior, Unit: UnitCount, Weighting: WeightingSampled, Kind: KindDistinct, Direction: DirectionNeutral,
		Value: uniq("unique_sessions"), Samples: events, Approximate: true,
	})
}
