![GitHub last commit](https://img.shields.io/github/last-commit/canislupaster/cpu-vscode)
![Visual Studio Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/thomasqm.cpu)
![Visual Studio Marketplace Rating](https://img.shields.io/visual-studio-marketplace/r/thomasqm.cpu)
![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/thomasqm.cpu)
![Visual Studio Marketplace Last Updated](https://img.shields.io/visual-studio-marketplace/last-updated/thomasqm.cpu)
![Static Badge](https://img.shields.io/badge/MIT%20-%20license)

# What's this, another CPH/acmX/FastOlympicCoding/... clone?

Yep. I think it looks *slightly* better than any solution out there, though, and has maybe one more feature?

This was designed primarily for C++ (though you're able to run Java/Python/Rust, but they are mostly untested). It was developed on MacOS and hasn't been tested much on Windows/Linux.

If you think it's the best option out there for you and need a couple features/fixes, just open an issue on the Github. **This is basically in alpha! I've made it public to source feedback and hope to substantially improve it.**

![Screenshot](resources/screenshot.png)

# Features

- Integrates with clangd and CodeLLDB to provide compilation commands and debugging. 
- File I/O support
- Bulk import test cases from directory
- [Competitive Companion integration](https://github.com/jmerle/competitive-companion)
- Stress testing
- Custom interactor and checker support
- Realtime I/O (in addition to test case inputs)
- Debugging for all supported languages (if you have the right extensions installed)

# Notes

- To enable debugging & linting, **install CodeLLDB and clangd**
- The run/debug options for stress tests run/debug the test generator for a random choice of `i`.
- You probably need to fudge the compiler and arguments in the test editor or VSCode settings to fit your setup (currently it defaults g++, fallback clang)
- Changing settings in the test editor will only change them for your current workspace (or globally if none)
- Integrates with [Competitive Companion](https://github.com/jmerle/competitive-companion/tree/master), though uses the host port for Hightail (so you won't be able to use both of our integrations at once)
- Debugging C++ uses SIGSTOP to halt the program while waiting for the debugger to attach (this was the simplest way). I'm not sure this works on Windows.
- I feel incompetent because whenever I implement things it seems 10x more complicated than it needs to be, which creates so many failure modes. This thing is not super robust and I expect to discover many bugs.
	- If you ever want to laugh at some sad code, this is a goldmine!

Built with React and 634 other npm packages. Bundled with ESBuild.