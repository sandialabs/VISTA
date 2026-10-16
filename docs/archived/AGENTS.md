The backend is in the /backend folder. 
All python commands need to make sure they use the virtual env in the /backend/.venv folder.

This project uses UV
So, to add new dependencies, you need to add them to the pyproject.toml file and then run:
```bash
cd backend
source .venv/bin/activate
uv sync
```

The frontened can be run with 

```
cd frontend
npm run dev
```


At the end of a update, in the root folder, you should run the test suite. 

```
bash test/run_tests.sh
```