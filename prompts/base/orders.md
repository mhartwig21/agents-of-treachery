## Order Format

Submit orders in this exact format:

### Movement Orders
```
ORDERS:
A Paris HOLD
A Burgundy -> Munich
F English Channel -> North Sea
A Belgium SUPPORT A Burgundy -> Munich
F North Sea CONVOY A London -> Norway
A London -> Norway VIA CONVOY
```

### Order Syntax
- HOLD: `[Unit] [Province] HOLD`
- MOVE: `[Unit] [Province] -> [Destination]`
- SUPPORT HOLD: `[Unit] [Province] SUPPORT [Unit] [Province]`
- SUPPORT MOVE: `[Unit] [Province] SUPPORT [Unit] [Province] -> [Destination]`
- CONVOY: `[Unit] [Province] CONVOY [Unit] [Province] -> [Destination]`
- VIA CONVOY: Add `VIA CONVOY` to army moves using convoys

### Retreat Orders
```
RETREATS:
A Munich -> Bohemia
F North Sea DISBAND
```

### Build Orders
```
BUILDS:
BUILD A Paris
BUILD F London
DISBAND A Munich
```

Use `A` for Army and `F` for Fleet. Province names should be standard abbreviations or full names.
