# FuckingFast Direct Link Extractor

A simple browser script that converts **FuckingFast** share links into their final direct download URLs.

The script sends the required POST request for each shared file, extracts the `hx-redirect` response header, and saves all direct links into a text file.

## Features

- Extracts direct download URLs automatically
- Processes multiple links sequentially
- 1-second delay between requests
- Progress logging in the browser console
- Automatically downloads the results as `Out_Direct_Links.txt`
- No external dependencies

## Usage

### 1. Edit the Links

Replace the contents of the `links` array with your own FuckingFast URLs.

```js
const links = [
    "https://fuckingfast.co/xxxxxxxx",
    "https://fuckingfast.co/yyyyyyyy",
];
```

### 2. Open the Website

Open any FuckingFast page while logged in (if required).

### 3. Open Developer Tools

Press:

```
F12
```

Go to the **Console** tab.

### 4. Paste the Script

Paste the entire script into the console and press **Enter**.

### 5. Wait

The script will:

- Process every link
- Print progress in the console
- Collect every direct download URL
- Automatically download:

```
Out_Direct_Links.txt
```

## How It Works

For every link, the script:

1. Extracts the file ID.
2. Sends a POST request to:

```
/f/{id}/go
```

3. Reads the `hx-redirect` response header.
4. Stores the direct URL.
5. Repeats until all links are processed.

## Example Output

```
https://cdn1.example.com/file1.rar
https://cdn2.example.com/file2.rar
https://cdn3.example.com/file3.rar
```

## Notes

- Run the script from a FuckingFast page so relative requests work correctly.
- A one-second delay is included to reduce request spam.
- Failed requests are reported in the browser console without stopping the extraction.

## License

MIT
