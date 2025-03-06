# chrome fzf - wsl
TS equivalent of [this. (Browsing Chrome history and bookmarks with fzf - junegunn.choi)](https://junegunn.github.io/fzf/examples/chrome/)

## usage

```bash
bun chrome-fzf.ts -p "Profile 4" h # history
bun chrome-fzf.ts -p "Profile 4" b # bookmarks
```

find the right profile name, by checking the dir name here:
- **darwin**
    - Library/Application Support/Google/Chrome
- **linux**
    - .config/google-chrome
- **windows**
    - AppData\Local\Google\Chrome\User Data
