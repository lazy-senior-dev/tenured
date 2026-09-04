# vhs docs/demo.tape  ->  assets/demo.gif
Output assets/demo.gif
Set Shell "bash"
Set FontSize 18
Set Width 1100
Set Height 620
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Type "claude"
Enter
Sleep 800ms
Type "add a /me endpoint that returns the profile and notification settings"
Enter
Sleep 1500ms
Type "echo 'Writing app/api/profiles.py ...'"
Enter
Sleep 700ms
Type "printf 'TENURED: DO_NOT_REPEAT\n1. app/api/profiles.py:14 - user_id is read from the request body, so any caller can read any profile - take it from the session\nwrite denied until fixed\n'"
Enter
Sleep 2500ms
Type "echo 'Taking user_id from the session instead. Reviewing again ...'"
Enter
Sleep 900ms
Type "printf 'TENURED: NEW\nNew to me.\nWriting app/api/profiles.py ... done\n'"
Enter
Sleep 3000ms
