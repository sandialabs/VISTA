# Kubernetes Deployment Test

Minimal Kubernetes manifests for testing deployment on minikube.

## Files

- `postgres.yaml` - PostgreSQL database
- `minio.yaml` - MinIO object storage  
- `configmap.yaml` - Application configuration
- `secret.yaml` - Sensitive configuration (base64 encoded)
- `app.yaml` - Main application deployment

## Usage

```bash
# Start minikube
minikube start

# Build and load image
podman build -t vista:latest .
minikube image load vista:latest

# Deploy all components
kubectl apply -f deployment-test/

# Check status
kubectl get pods

# Access application
minikube service vista --url
# Or: kubectl port-forward service/vista 8000:8000

# Clean up
kubectl delete -f deployment-test/
```

## Notes

- Uses emptyDir volumes (data will not persist)
- Default credentials for testing only
- NodePort service for easy access
- Health checks assume `/health` endpoint exists