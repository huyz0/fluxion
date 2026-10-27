// Standalone WOFF2 codec ABI: the host owns allocation, writes into a bounded, pre-zeroed output buffer.
#include <cstring>
#include <cstdlib>
#include <woff2/decode.h>
#include <woff2/encode.h>
#include <woff2/output.h>

extern "C" {
__attribute__((export_name("codec_alloc"))) void* codec_alloc(size_t n) { return std::malloc(n); }
__attribute__((export_name("codec_free"))) void codec_free(void* p) { std::free(p); }
__attribute__((export_name("woff2_max_encoded"))) size_t woff2_max_encoded(const uint8_t* data, size_t length) {
  return woff2::MaxWOFF2CompressedSize(data, length);
}
// Returns the encoded length, or 0 on failure. The whole destination is zeroed first (padding is never stale).
__attribute__((export_name("woff2_encode"))) size_t woff2_encode(const uint8_t* data, size_t length, uint8_t* out, size_t capacity) {
  std::memset(out, 0, capacity);
  size_t written = capacity;
  return woff2::ConvertTTFToWOFF2(data, length, out, &written) ? written : 0;
}
__attribute__((export_name("woff2_final_size"))) size_t woff2_final_size(const uint8_t* data, size_t length) {
  return woff2::ComputeWOFF2FinalSize(data, length);
}
// Returns the decoded length, or 0 on failure; never writes past capacity.
__attribute__((export_name("woff2_decode"))) size_t woff2_decode(const uint8_t* data, size_t length, uint8_t* out, size_t capacity) {
  std::memset(out, 0, capacity);
  woff2::WOFF2MemoryOut sink(out, capacity);
  return woff2::ConvertWOFF2ToTTF(data, length, &sink) ? sink.Size() : 0;
}
}
