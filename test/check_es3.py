"""Conservative lexical ES3 guard. Runtime table proof is separate."""
from pathlib import Path
import re
import sys


def check(text):
    # Erase comments and string/regex literals before examining code tokens.
    pattern = r'''//[^\n]*|/\*[\s\S]*?\*/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+/[gim]*'''
    code = re.sub(pattern, lambda m: ' ' * len(m[0]), text)
    if re.search(r'\b(let|const|class|BigInt)\b|=>|`|\b\d+n\b', code):
        raise ValueError('MISS ES3: unsupported modern syntax')
    # A nested conditional needs its own parenthesized expression. Count at
    # each delimiter level, resetting only at a statement/comma boundary.
    stack = [0]
    for ch in code:
        if ch in '([{': stack.append(0)
        elif ch in ')]}':
            if len(stack) > 1: stack.pop()
        elif ch in ';,': stack[-1] = 0
        elif ch == '?':
            stack[-1] += 1
            if stack[-1] > 1:
                raise ValueError('MISS ES3: unbracketed chained conditional')


if __name__ == '__main__':
    try:
        check(Path(sys.argv[1]).read_text())
        print('ES3 CHECK OK: no modern syntax or unbracketed chained conditional')
    except ValueError as e:
        print(e)
        sys.exit(1)
