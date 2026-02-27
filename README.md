# forkloom verification harness

`forkloom` is a `mise`-only verification harness with durable/fault/golden checks.

## bootstrap

```bash
mise trust
mise install
MISE_EXPERIMENTAL=1 mise prep
MISE_EXPERIMENTAL=1 mise run bootstrap
```

## local loop

```bash
MISE_EXPERIMENTAL=1 mise watch check test:int golden
```

## ordered verification

```bash
MISE_EXPERIMENTAL=1 mise run bootstrap:doctor
MISE_EXPERIMENTAL=1 mise run check:contract
MISE_EXPERIMENTAL=1 mise run check:unit
MISE_EXPERIMENTAL=1 mise run test:int
MISE_EXPERIMENTAL=1 mise run test:sys
MISE_EXPERIMENTAL=1 mise run golden
MISE_EXPERIMENTAL=1 mise run fault
MISE_EXPERIMENTAL=1 mise run bench
```

## ci freshness override

```bash
MISE_EXPERIMENTAL=1 mise run ci:force
```
