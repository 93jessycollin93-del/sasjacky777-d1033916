import uvicorn
from router_final import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4000)
