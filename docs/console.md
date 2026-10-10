# Console command box

The box in the console's tab bar sends one typed command to the controller and shows what it
printed back. Its main use is reading and changing GRBL settings.

It is on the **Console** tab, next to the tab names. It works when a real machine is connected
and no job is running. It is not available with the simulator.

## Check laser mode

1. Connect to the machine.
2. Type `$$` and press Enter. The controller prints all its settings.
3. After the list, MakerLaser adds a line saying what `$32` (laser mode) is set to.

`$32=1` is what MakerLaser expects. With it, the beam drops to nothing whenever the head is not
moving, which is what keeps Frame with laser on safe. If `$32=0`, type `$32=1` and press Enter,
then `$$` again to check. The setting is stored on the controller and stays.

## Useful commands

| Type | What it does |
|---|---|
| `$$` | List all settings. |
| `$32=1` | Turn laser mode on. |
| `$I` | Show the firmware version. |
| `$#` | Show the stored coordinate offsets. |
| `$G` | Show the current modal state (units, coordinate system and so on). |
| `$H` | Home the machine. |
| `$X` | Unlock after an alarm. |
| `G0 X10 Y10` | Move to a position (in the current coordinate system). |

Up and Down arrows step through the commands you sent earlier this session.

## What it will not send

The box is deliberately narrower than a serial terminal:

- **`M3` and `M4`.** They switch the laser on. The beam is only lit by a job or by Frame with
  laser on, which have their own limits and warnings.
- **`$RST`.** It wipes every setting on the controller.
- **`!`, `~`, `?` and Ctrl-X.** These are real-time characters. Use the Pause, Resume and STOP
  buttons. The status is polled for you.
- **Anything longer than 80 characters, or more than one line.** GRBL's line buffer is small.
- **Anything while a job is running.** Use Pause or STOP.

## Things to know

- Homing (`$H`) and changing `$3`, `$10`, `$13` or `$23` make a stored user origin meaningless,
  so MakerLaser forgets it. Set it again with the head where you want it.
- STOP ends a command that is waiting for the controller.
- A command the controller rejects shows its `error:` code and what it means, as jobs do.
- Typed commands are not remembered between sessions.
