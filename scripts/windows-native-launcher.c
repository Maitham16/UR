/*
 * UR Windows launcher, managed ur.cmd protocol v1 (exact UTF-8, six CRLF lines).
 * Build in an MSVC developer environment:
 * cl /O2 /MT /W4 /WX /utf-8 /Brepro /Fe:ur.exe windows-native-launcher.c \
 *   /link /Brepro /SUBSYSTEM:CONSOLE
 * No command interpreter or separately installed language runtime is required.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

#define CONFIG_LIMIT (512UL * 1024UL)
#define PATH_CAPACITY 32768UL

static int fail(const char *reason, DWORD error) {
    if (error != 0) fprintf(stderr, "ur launcher: %s (Windows error %lu).\n", reason, error);
    else fprintf(stderr, "ur launcher: %s.\n", reason);
    return 125;
}

static BOOL take(const wchar_t **cursor, const wchar_t *literal) {
    size_t length = wcslen(literal);
    if (wcsncmp(*cursor, literal, length) != 0) return FALSE;
    *cursor += length;
    return TRUE;
}

static BOOL absolute_path(const wchar_t *path) {
    size_t length = wcslen(path);
    const wchar_t *share;
    if (length >= 3 && ((path[0] >= L'A' && path[0] <= L'Z') ||
        (path[0] >= L'a' && path[0] <= L'z')) && path[1] == L':' && path[2] == L'\\') return TRUE;
    if (length < 5 || path[0] != L'\\' || path[1] != L'\\' ||
        path[2] == L'?' || path[2] == L'.' || path[2] == L'\\') return FALSE;
    share = wcschr(path + 2, L'\\');
    return share != NULL && share[1] != L'\0' && share[1] != L'\\';
}

/* A percent sign in the managed batch protocol must be escaped as %%. */
static BOOL path_value(const wchar_t **cursor, wchar_t *result) {
    size_t length = 0;
    while (**cursor != L'"') {
        wchar_t character = **cursor;
        if (character < L' ' || length >= PATH_CAPACITY - 1) return FALSE;
        ++*cursor;
        if (character == L'%') {
            if (**cursor != L'%') return FALSE;
            ++*cursor;
        }
        result[length++] = character;
    }
    result[length] = L'\0';
    return absolute_path(result);
}

static BOOL read_config(wchar_t **contents) {
    wchar_t own_path[PATH_CAPACITY];
    wchar_t *separator;
    HANDLE file = INVALID_HANDLE_VALUE;
    LARGE_INTEGER size;
    char *bytes = NULL;
    wchar_t *wide = NULL;
    DWORD count, offset = 0;
    DWORD own_length = GetModuleFileNameW(NULL, own_path, PATH_CAPACITY);
    int length, index;
    BOOL success = FALSE;
    if (own_length == 0 || own_length >= PATH_CAPACITY) return FALSE;
    separator = wcsrchr(own_path, L'\\');
    if (separator == NULL || (size_t)(separator - own_path) + 8 >= PATH_CAPACITY) return FALSE;
    memcpy(separator + 1, L"ur.cmd", sizeof(L"ur.cmd"));
    file = CreateFileW(own_path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
        NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) goto done;
    if (!GetFileSizeEx(file, &size) || size.QuadPart <= 0 || size.QuadPart > CONFIG_LIMIT) goto done;
    bytes = (char *)HeapAlloc(GetProcessHeap(), 0, (SIZE_T)size.QuadPart);
    if (bytes == NULL) goto done;
    while (offset < (DWORD)size.QuadPart) {
        if (!ReadFile(file, bytes + offset, (DWORD)size.QuadPart - offset, &count, NULL) || count == 0) goto done;
        offset += count;
    }
    length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes, (int)offset, NULL, 0);
    if (length <= 0) goto done;
    wide = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, ((SIZE_T)length + 1) * sizeof(wchar_t));
    if (wide == NULL || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes,
        (int)offset, wide, length) != length) goto done;
    for (index = 0; index < length; ++index) if (wide[index] == L'\0') goto done;
    wide[length] = L'\0';
    *contents = wide;
    wide = NULL;
    success = TRUE;
done:
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    if (bytes != NULL) HeapFree(GetProcessHeap(), 0, bytes);
    if (wide != NULL) HeapFree(GetProcessHeap(), 0, wide);
    return success;
}

static BOOL parse_config(const wchar_t *text, wchar_t *bin, wchar_t *data, wchar_t *executable) {
    return take(&text, L"@echo off\r\n@setlocal DisableDelayedExpansion\r\n"
        L"@\"%SystemRoot%\\System32\\chcp.com\" 65001 >nul\r\n@set \"UR_NATIVE_BIN_DIR=") &&
        path_value(&text, bin) && take(&text, L"\"\r\n@set \"UR_NATIVE_DATA_DIR=") &&
        path_value(&text, data) && take(&text, L"\"\r\n\"") &&
        path_value(&text, executable) && take(&text, L"\" %*\r\n") && *text == L'\0';
}

static BOOL canonical_path(const wchar_t *input, wchar_t *output) {
    DWORD length = GetFullPathNameW(input, PATH_CAPACITY, output, NULL);
    if (length == 0 || length >= PATH_CAPACITY) return FALSE;
    while (length > 3 && output[length - 1] == L'\\') output[--length] = L'\0';
    return TRUE;
}

static BOOL managed_paths(const wchar_t *bin, const wchar_t *data, const wchar_t *executable) {
    wchar_t *storage = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, 4 * PATH_CAPACITY * sizeof(wchar_t));
    wchar_t *canonical_bin, *canonical_data, *canonical_executable, *own;
    const wchar_t *release, *separator, *version_prefix;
    size_t data_length, executable_length, prefix_length;
    DWORD own_length;
    BOOL valid = FALSE;
    if (storage == NULL) return FALSE;
    canonical_bin = storage;
    canonical_data = storage + PATH_CAPACITY;
    canonical_executable = storage + 2 * PATH_CAPACITY;
    own = storage + 3 * PATH_CAPACITY;
    own_length = GetModuleFileNameW(NULL, own, PATH_CAPACITY);
    if (own_length == 0 || own_length >= PATH_CAPACITY ||
        !canonical_path(bin, canonical_bin) || !canonical_path(data, canonical_data) ||
        !canonical_path(executable, canonical_executable)) goto done;
    if (CompareStringOrdinal(own, -1, canonical_executable, -1, TRUE) == CSTR_EQUAL) goto done;
    separator = wcsrchr(own, L'\\');
    if (separator == NULL) goto done;
    own[(size_t)(separator - own) + 1] = L'\0';
    own_length = (DWORD)wcslen(own);
    while (own_length > 3 && own[own_length - 1] == L'\\') own[--own_length] = L'\0';
    if (CompareStringOrdinal(own, -1, canonical_bin, -1, TRUE) != CSTR_EQUAL) goto done;
    data_length = wcslen(canonical_data);
    executable_length = wcslen(canonical_executable);
    version_prefix = canonical_data[data_length - 1] == L'\\' ? L"versions\\" : L"\\versions\\";
    prefix_length = wcslen(version_prefix);
    if (executable_length <= data_length + prefix_length ||
        CompareStringOrdinal(canonical_executable, (int)data_length, canonical_data, (int)data_length, TRUE) != CSTR_EQUAL ||
        CompareStringOrdinal(canonical_executable + data_length, (int)prefix_length, version_prefix, (int)prefix_length, TRUE) != CSTR_EQUAL) goto done;
    release = canonical_executable + data_length + prefix_length;
    separator = wcschr(release, L'\\');
    valid = separator != NULL && separator != release && wcschr(release, L'/') == NULL &&
        CompareStringOrdinal(separator, -1, L"\\ur.exe", -1, TRUE) == CSTR_EQUAL;
done:
    HeapFree(GetProcessHeap(), 0, storage);
    return valid;
}

/* The CRT treats argv[0] specially: quotes group it; backslashes are literal.
 * Keep the remaining command line byte-for-byte (UTF-16 code-unit-for-unit). */
static const wchar_t *argument_tail(const wchar_t *command) {
    BOOL quoted = FALSE;
    while (*command != L'\0') {
        if (*command == L'"') quoted = !quoted;
        else if (!quoted && (*command == L' ' || *command == L'\t')) break;
        ++command;
    }
    return command;
}

static BOOL WINAPI console_control(DWORD event) {
    return event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT;
}

static BOOL inherit_stream(DWORD identifier, HANDLE *child, HANDLE *duplicate) {
    HANDLE original = GetStdHandle(identifier);
    *duplicate = NULL;
    *child = original;
    if (original == NULL || original == INVALID_HANDLE_VALUE) return TRUE;
    if (!DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), duplicate,
        0, TRUE, DUPLICATE_SAME_ACCESS)) return FALSE;
    *child = *duplicate;
    return TRUE;
}

int wmain(void) {
    wchar_t *config = NULL, *paths = NULL, *command = NULL;
    wchar_t *bin, *data, *executable;
    const wchar_t *tail;
    size_t executable_length, tail_length, command_length;
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION process = {0};
    HANDLE streams[3] = {NULL, NULL, NULL};
    DWORD code = 125;
    int result = 125;
    unsigned int index;
    if (!read_config(&config)) return fail("cannot read a valid adjacent ur.cmd", GetLastError());
    paths = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, 3 * PATH_CAPACITY * sizeof(wchar_t));
    if (paths == NULL) { result = fail("cannot allocate launcher configuration", 0); goto done; }
    bin = paths;
    data = paths + PATH_CAPACITY;
    executable = paths + 2 * PATH_CAPACITY;
    if (!parse_config(config, bin, data, executable)) {
        result = fail("adjacent ur.cmd is not managed protocol v1", 0); goto done;
    }
    if (!managed_paths(bin, data, executable)) {
        result = fail("adjacent ur.cmd does not name this managed installation", 0); goto done;
    }
    /* The file handle was closed by read_config before the child can update it. */
    if (!SetEnvironmentVariableW(L"UR_NATIVE_BIN_DIR", bin) ||
        !SetEnvironmentVariableW(L"UR_NATIVE_DATA_DIR", data)) {
        result = fail("cannot set managed installation directories", GetLastError()); goto done;
    }
    tail = argument_tail(GetCommandLineW());
    executable_length = wcslen(executable);
    tail_length = wcslen(tail);
    command_length = executable_length + tail_length + 3;
    if (command_length > 32767) { result = fail("command line exceeds the Windows limit", 0); goto done; }
    command = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, command_length * sizeof(wchar_t));
    if (command == NULL) { result = fail("cannot allocate child command line", 0); goto done; }
    command[0] = L'"';
    memcpy(command + 1, executable, executable_length * sizeof(wchar_t));
    command[executable_length + 1] = L'"';
    memcpy(command + executable_length + 2, tail, (tail_length + 1) * sizeof(wchar_t));
    startup.cb = (DWORD)sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    if (!inherit_stream(STD_INPUT_HANDLE, &startup.hStdInput, &streams[0]) ||
        !inherit_stream(STD_OUTPUT_HANDLE, &startup.hStdOutput, &streams[1]) ||
        !inherit_stream(STD_ERROR_HANDLE, &startup.hStdError, &streams[2])) {
        result = fail("cannot inherit standard streams", GetLastError()); goto done;
    }
    if (GetConsoleCP() != 0) {
        /* Clear an inherited ignore attribute; custom handlers are not inherited. */
        if (!SetConsoleCtrlHandler(NULL, FALSE) || !SetConsoleCtrlHandler(console_control, TRUE)) {
            result = fail("cannot configure console control handling", GetLastError()); goto done;
        }
    }
    if (!CreateProcessW(executable, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process)) {
        result = fail("cannot start installed UR executable", GetLastError()); goto done;
    }
    CloseHandle(process.hThread);
    for (index = 0; index < 3; ++index) {
        if (streams[index] != NULL) CloseHandle(streams[index]);
        streams[index] = NULL;
    }
    if (WaitForSingleObject(process.hProcess, INFINITE) != WAIT_OBJECT_0 ||
        !GetExitCodeProcess(process.hProcess, &code)) {
        result = fail("cannot wait for installed UR executable", GetLastError());
        CloseHandle(process.hProcess);
        goto done;
    }
    CloseHandle(process.hProcess);
    result = (int)code;
done:
    for (index = 0; index < 3; ++index) if (streams[index] != NULL) CloseHandle(streams[index]);
    if (command != NULL) HeapFree(GetProcessHeap(), 0, command);
    if (paths != NULL) HeapFree(GetProcessHeap(), 0, paths);
    if (config != NULL) HeapFree(GetProcessHeap(), 0, config);
    return result;
}
