import pytest
from worker.router import route

def test_everything_routes_fast_in_v0():
    assert route("what's in the queue?") == "fast"

def test_route_rejects_empty():
    with pytest.raises(ValueError):
        route("   ")
