package handlers

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricsHandler returns the Prometheus metrics handler
func (h *Handlers) MetricsHandler() http.Handler {
	return promhttp.Handler()
}
