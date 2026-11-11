import json
import re
import shlex
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_PACKAGE_JSON = REPO_ROOT / "frontend" / "package.json"

SCRIPT_COMMAND_PACKAGES = {
    "cross-env": "cross-env",
    "cross-env-shell": "cross-env",
    "eslint": "eslint",
    "jest": "jest",
    "playwright": "playwright",
    "vite": "vite",
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



# The UI builds with Vite and tests with Jest directly. react-scripts (Create React App)
# pinned old webpack, webpack-dev-server, svgo and jest releases with open advisories that
# no override could fix; it must not come back.
REMOVED_TOOLCHAIN = (
    "react-scripts",
    "react-app-rewired",
    "webpack",
    "webpack-dev-server",
    "webpack-bundle-analyzer",
    "eslint-config-react-app",
)

# Patched releases forced for Jest's transitive dependencies.
SECURITY_OVERRIDES = {"glob": "14.0.2", "minimatch@>=7": "11.0.1"}


def _lock_packages():
    lock_path = REPO_ROOT / "frontend" / "package-lock.json"
    return json.loads(lock_path.read_text(encoding="utf-8"))["packages"]


def _locked_versions(name):
    suffix = f"node_modules/{name}"
    return {meta["version"] for path, meta in _lock_packages().items() if path.endswith(suffix)}


def _version_tuple(version):
    return tuple(int(part) for part in version.split(".")[:3])


def test_create_react_app_toolchain_is_not_installed():
    package = _load_frontend_package()
    declared = set(package.get("dependencies", {})) | set(package.get("devDependencies", {}))
    for name in REMOVED_TOOLCHAIN:
        assert name not in declared, name
        assert not _locked_versions(name), f"{name} is still in package-lock.json"
    for name in ("vite", "jest", "eslint"):
        assert name in declared, name


def test_security_overrides_stay_in_package_json_and_the_lockfile():
    overrides = _load_frontend_package()["overrides"]
    for name, spec in SECURITY_OVERRIDES.items():
        assert overrides.get(name) == spec, name
    globs = _locked_versions("glob")
    assert globs and all(_version_tuple(v) >= (14, 0, 2) for v in globs), globs
    for version in _locked_versions("minimatch"):
        major = _version_tuple(version)[0]
        # minimatch 3 is outside the advisory range (>=7.0.0 <11.0.1); 7 and later must be fixed.
        assert major < 7 or _version_tuple(version) >= (11, 0, 1), version


def test_lockfile_resolves_only_from_the_public_registry():
    hosts = {
        meta["resolved"].split("/")[2]
        for meta in _lock_packages().values()
        if meta.get("resolved", "").startswith("http")
    }
    assert hosts == {"registry.npmjs.org"}, hosts
