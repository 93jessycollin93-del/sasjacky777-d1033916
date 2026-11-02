import shutil, pathlib
src = pathlib.Path(__file__).parent
dst = src.parent / "dist"
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("*.py", "__pycache__"))
print("built", dst)
