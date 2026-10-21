import copy
import sys

sys.path.insert(0, "/app")
from normalize import normalize

for values, expected in [
    ([], []),
    ([None, 7, False, "", " \t"], []),
    ([" B ", "a", "b", "A", " C "], ["b", "a", "c"]),
    ([" CAFÉ ", "café", "你好"], ["café", "你好"]),
]:
    before = copy.deepcopy(values)
    result = normalize(values)
    assert result == expected, (result, expected)
    assert values == before
    assert result is not values
