# orion-install-probe.zip

A Chrome-format extension with a manifest and a popup in it and nothing else —
913 bytes, no permissions, no content script, no background.

It exists to answer one question, which the device asks often and answers
badly: **is Orion refusing this package, or is it refusing every package?**

Orion's iOS installer fails with one line — "Extensions Error. Something went
wrong." — whatever the cause, and the causes are not alike. It cannot install
over an existing copy. The first attempt after removing one usually fails too.
A stale Downloads-folder bookmark makes every file install fail
([orionfeedback #10475](https://orionfeedback.org/d/10475),
[#10293](https://orionfeedback.org/d/10293-cant-install-extensions)). And a zip
sitting in iCloud Drive that has not been fetched to the device fails the same
way a broken package does.

**Try clearing Orion's cache first.** On 2026-08-11 that is what finally worked
on the device, after removing-and-reinstalling and the open-then-close-the-sheet
trick had each worked only sometimes. A cached copy of the previously downloaded
zip looks like the likely culprit, which is why it comes back with every new
version fetched from the same URL.

If that does not do it, install this.

- **It installs** → the installer works right now. The problem is our package,
  and it is worth reading the manifest diff between the version that worked and
  the one that does not.
- **It fails too** → nothing is wrong with our zip. Reset the Downloads folder
  in Orion's settings, move the file out of iCloud Drive, restart the app,
  update Orion. Do not spend the evening bisecting releases: that has cost two
  already, and both times the packages turned out to be the same shape.

Download it on the phone from:

    https://github.com/jshsakura/oc-ad-bye-pass/raw/main/tools/orion-install-probe.zip
