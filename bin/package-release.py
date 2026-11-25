"""Package the checked-out source, verified demo, and CLI for a tagged release."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text())
version = package["version"]
if os.environ.get("RELEASE_TAG", f"v{version}") != f"v{version}":
    raise SystemExit("Release tag must match package.json.")
demo = root / "demo"
metadata = demo / "__spechatch"
inventory = json.loads((metadata / "inventory.json").read_text())
receipt = json.loads((metadata / "receipt.json").read_text())
if receipt["buildId"] != inventory["id"] or not receipt["tests"] or receipt["misses"]:
    raise SystemExit("A verified demo is required. Run npm run check.")
expected = set(inventory["files"]) | {"__spechatch/inventory.json", "__spechatch/receipt.json"}
actual = {p.relative_to(demo).as_posix() for p in demo.rglob("*") if p.is_file()}
if actual != expected:
    raise SystemExit("Exported file list changed after verification.")
for name, digest in inventory["files"].items():
    if hashlib.sha256((demo / name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Exported asset changed: {name}")

output = root / "release"
output.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=output) as work:
    stage = Path(work)
    subprocess.run(["npm", "pack", "--pack-destination", str(stage), "--silent"], check=True, cwd=root)
    tarball = stage / f"{package['name']}-{version}.tgz"
    with tarfile.open(tarball) as package_archive:
        package_archive.getmember("package/dist/cli.js")
    archive = stage / f"SpecHatch-{version}.zip"
    source = subprocess.check_output(["git", "archive", "--format=zip", "HEAD"], cwd=root)
    with ZipFile(io.BytesIO(source)) as git_zip, ZipFile(archive, "w", ZIP_DEFLATED) as release:
        for name in git_zip.namelist():
            if not name.endswith("/"):
                release.writestr(f"spechatch/{name}", git_zip.read(name))
        for name in sorted(actual):
            release.write(demo / name, f"spechatch/demo/{name}")
        release.write(tarball, f"spechatch/packages/{tarball.name}")
    with ZipFile(archive) as checked:
        if checked.testzip() is not None:
            raise SystemExit("Release ZIP failed validation.")
    for file in [tarball, archive]:
        file.replace(output / file.name)
        print(output / file.name)
