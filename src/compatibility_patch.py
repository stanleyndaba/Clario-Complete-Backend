import pydantic.typing

# Monkey patch to fix Python 3.13 compatibility
original_evaluate_forwardref = pydantic.typing.evaluate_forwardref

def patched_evaluate_forwardref(type_, globalns=None, localns=None):
    try:
        return original_evaluate_forwardref(type_, globalns, localns)
    except TypeError as e:
        if 'recursive_guard' in str(e):
            # Try the new signature for Python 3.13
            return type_._evaluate(globalns, localns, recursive_guard=set())
        raise

pydantic.typing.evaluate_forwardref = patched_evaluate_forwardref
