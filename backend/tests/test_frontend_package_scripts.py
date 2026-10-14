import json
import re
import shlex
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_PACKAGE_JSON = REPO_ROOT / "frontend" / "package.json"

SCRIPT_COMMAND_PACKAGES = {
    "cross-env": "cross-env",
    "cross-env-shell": "cross-env",
    "playwright": "playwright",
    "react-app-rewired": "react-app-rewired",
    "react-scripts": "react-scripts",
    "webpack-bundle-analyzer": "webpack-bundle-analyzer",
}

SHELL_OPERATORS = {"&&", "||", ";", "|"}
NPM_PROVIDED_COMMANDS = {"npm", "npx"}


def _load_frontend_package():
    with FRONTEND_PACKAGE_JSON.open(encoding="utf-8") as package_file:
        return json.load(package_file)


def _script_executables(script):
    tokens = shlex.split(script, posix=True)
    executable_expected = True

    for token in tokens:
        if token in SHELL_OPERATORS:
            executable_expected = True
            continue

        if not executable_expected:
            continue

        executable_expected = False

        # POSIX-style environment assignments are not portable by themselves,
        # but wrappers such as cross-env may still pass them through.
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", token):
            executable_expected = True
            continue

        yield token


def test_frontend_npm_script_commands_are_declared_dependencies():
    package = _load_frontend_package()
    declared_packages = set(package.get("dependencies", {}))
    declared_packages.update(package.get("devDependencies", {}))
    declared_packages.update(package.get("optionalDependencies", {}))

    missing = []
    for script_name, script in package.get("scripts", {}).items():
        for executable in _script_executables(script):
            if executable in NPM_PROVIDED_COMMANDS:
                continue

            package_name = SCRIPT_COMMAND_PACKAGES.get(executable)
            if package_name and package_name not in declared_packages:
                missing.append(f"{script_name}: {executable} requires {package_name}")

    assert not missing, (
        "npm scripts reference package-provided commands that are not declared "
        f"in frontend/package.json: {missing}"
    )
