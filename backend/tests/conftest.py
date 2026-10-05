import os
import sys
import tempfile

# Isolate every test run from the real user data folder, before config is imported.
_data_dir = tempfile.mkdtemp(prefix="cadence-test-")
os.environ["CADENCE_DATA_DIR"] = _data_dir
os.environ["CADENCE_TOKEN"] = "test-token"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
