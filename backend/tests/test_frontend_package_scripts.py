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


# Security overrides for Create React App's pinned transitive dependencies. Each maps to a
# patched release that is API-compatible with its caller; dropping one reintroduces advisories.
SECURITY_OVERRIDES = {
    "underscore": "^1.13.8",
    "serialize-javascript": "^7.1.4",
    "sockjs": {"uuid": "^11.1.1"},
    "http-proxy-agent": {"@tootallnate/once": "^2.0.1"},
}


def _locked_versions(name):
    lock_path = REPO_ROOT / "frontend" / "package-lock.json"
    packages = json.loads(lock_path.read_text(encoding="utf-8"))["packages"]
    suffix = f"node_modules/{name}"
    return {meta["version"] for path, meta in packages.items() if path.endswith(suffix)}


def test_security_overrides_stay_in_package_json_and_the_lockfile():
    overrides = _load_frontend_package()["overrides"]
    for name, spec in SECURITY_OVERRIDES.items():
        assert overrides.get(name) == spec, name
    for name, floor in (
        ("underscore", (1, 13, 8)),
        ("serialize-javascript", (7, 1, 4)),
        ("uuid", (11, 1, 1)),
        ("@tootallnate/once", (2, 0, 1)),
    ):
        versions = _locked_versions(name)
        assert versions, name
        for version in versions:
            assert tuple(int(part) for part in version.split(".")[:3]) >= floor, (name, version)
