using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

public sealed class EmoteAsset : IDisposable {
 readonly MemoryStream stream;readonly Image image;readonly int[] delays;readonly int cycle;int selectedFrame=-1;
 public EmoteAsset(byte[] bytes){stream=new MemoryStream(bytes,false);try{image=Image.FromStream(stream);if(image.Width>512||image.Height>512)throw new IOException("Image is too large");int frames=1;if(image.FrameDimensionsList.Contains(System.Drawing.Imaging.FrameDimension.Time.Guid))frames=image.GetFrameCount(System.Drawing.Imaging.FrameDimension.Time);if(frames>500||(long)frames*image.Width*image.Height>16000000)throw new IOException("Animation is too large");delays=new int[frames];byte[] times=null;try{times=image.GetPropertyItem(0x5100).Value;}catch(ArgumentException){}for(int i=0;i<frames;i++){delays[i]=times!=null&&times.Length>=(i+1)*4?Math.Max(20,Math.Min(10000,BitConverter.ToInt32(times,i*4)*10)):100;cycle+=delays[i];}}catch{if(image!=null)image.Dispose();stream.Dispose();throw;}}
 public bool Animated{get{return delays.Length>1;}}
 public Image Frame{get{if(delays.Length>1){int elapsed=(int)((uint)Environment.TickCount%(uint)cycle),frame=0;while(frame<delays.Length-1&&elapsed>=delays[frame])elapsed-=delays[frame++];if(frame!=selectedFrame){image.SelectActiveFrame(System.Drawing.Imaging.FrameDimension.Time,frame);selectedFrame=frame;}}return image;}}
 public void Dispose(){image.Dispose();stream.Dispose();}
}
public sealed class EmoteCache : IDisposable {
 readonly Dictionary<string,EmoteAsset> images=new Dictionary<string,EmoteAsset>();readonly HashSet<string> pending=new HashSet<string>();readonly Dictionary<string,string> states=new Dictionary<string,string>();readonly Dictionary<string,DateTime> failed=new Dictionary<string,DateTime>();readonly Queue<string> order=new Queue<string>();
 readonly SemaphoreSlim slots=new SemaphoreSlim(3);readonly CancellationTokenSource stop=new CancellationTokenSource();
 readonly HttpClient client=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false}){Timeout=TimeSpan.FromSeconds(8)};bool disposed;
 public static bool Allowed(string address){Uri uri;if(!Uri.TryCreate(address,UriKind.Absolute,out uri)||uri.Scheme!="https"||!uri.IsDefaultPort||uri.UserInfo!="")return false;return new[]{"static-cdn.jtvnw.net","d3aqoihi2n8ty8.cloudfront.net","cdn.betterttv.net","cdn.frankerfacez.com","cdn.7tv.app","files.kick.com","yt3.ggpht.com","www.gstatic.com","yt3.googleusercontent.com"}.ContainsHost(uri.DnsSafeHost.ToLowerInvariant());}
 public bool IsAnimated(string url){EmoteAsset asset;return url!=null&&images.TryGetValue(url,out asset)&&asset.Animated;}
 public Image Find(string url){EmoteAsset asset;return images.TryGetValue(url,out asset)?asset.Frame:null;}
 public string Describe(string url){if(images.ContainsKey(url))return "Image loaded";if(!Allowed(url))return "Image host not supported";string state;return states.TryGetValue(url,out state)?state:"Image not loaded";}
 public void Store(string url,byte[] bytes){if(disposed)return;if(bytes.Length>2097152)throw new IOException("Image too large");var asset=new EmoteAsset(bytes);if(images.ContainsKey(url)){images[url].Dispose();images[url]=asset;return;}while(images.Count>=128){string oldest=order.Dequeue();images[oldest].Dispose();images.Remove(oldest);}images[url]=asset;order.Enqueue(url);}
 public async Task Load(string url,Action changed){DateTime retry;if(disposed||!Allowed(url)||images.ContainsKey(url)||pending.Count>=128||pending.Contains(url)||(failed.TryGetValue(url,out retry)&&DateTime.UtcNow<retry))return;pending.Add(url);states[url]="Loading image…";bool entered=false;var deadline=CancellationTokenSource.CreateLinkedTokenSource(stop.Token);try{await slots.WaitAsync(stop.Token);entered=true;deadline.CancelAfter(8000);string address=url;for(int redirect=0;redirect<3;redirect++){using(var response=await client.GetAsync(address,HttpCompletionOption.ResponseHeadersRead,deadline.Token)){int code=(int)response.StatusCode;if(code>=300&&code<400){var location=response.Headers.Location;if(location==null)throw new IOException();var target=location.IsAbsoluteUri?location:new Uri(new Uri(address),location);if(!Allowed(target.AbsoluteUri))throw new IOException();address=target.AbsoluteUri;continue;}response.EnsureSuccessStatusCode();if(response.Content.Headers.ContentLength>2097152)throw new IOException();using(var input=await response.Content.ReadAsStreamAsync())using(var memory=new MemoryStream()){var buffer=new byte[8192];int count;while((count=await input.ReadAsync(buffer,0,buffer.Length,deadline.Token))>0){if(memory.Length+count>2097152)throw new IOException();memory.Write(buffer,0,count);}Store(url,memory.ToArray());}break;}}if(!images.ContainsKey(url))throw new IOException();}catch(Exception ex){if(!disposed){states[url]="Image unavailable: "+EmoteNetwork.Error(ex);if(failed.Count>=256)failed.Clear();failed[url]=DateTime.UtcNow.AddSeconds(30);}}finally{deadline.Dispose();pending.Remove(url);if(entered)slots.Release();if(!disposed){if(states.Count>512)states.Clear();changed();}}}
 public void Dispose(){disposed=true;stop.Cancel();client.Dispose();foreach(var image in images.Values)image.Dispose();images.Clear();}
}

static class HostList {public static bool ContainsHost(this string[] values,string host){foreach(string value in values)if(value==host)return true;return false;}}

public static class SoundPreferences {
 public static string DefaultPath{get{return Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"notify.wav");}}
 static string SettingsPath{get{return Path.Combine(IntegratedHost.DataRoot,"sound-path.txt");}}
 public static string Read(){try{string path=File.ReadAllText(SettingsPath);if(File.Exists(path))return path;}catch(IOException){}catch(UnauthorizedAccessException){}return DefaultPath;}
 public static System.Media.SoundPlayer Load(string path){var info=new FileInfo(path);if(!info.Exists||info.Length>20971520||!info.Extension.Equals(".wav",StringComparison.OrdinalIgnoreCase))throw new IOException("Choose a WAV file smaller than 20 MB.");var player=new System.Media.SoundPlayer(path);try{player.Load();return player;}catch{player.Dispose();throw new IOException("This WAV file could not be read. Try a PCM WAV file.");}}
 public static void Save(string path){Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath));File.WriteAllText(SettingsPath,Path.GetFullPath(path));}
}

public sealed class DesktopAlert : Form {
 readonly Label heading=new Label(); readonly MessageView detail=new MessageView();
 readonly FlowLayoutPanel emotes=new FlowLayoutPanel();
 readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=7000};
 readonly Action open;
 readonly PictureBox icon=new PictureBox();
 Alert current;
 public DesktopAlert(Icon appIcon,Action openApp){open=openApp;DoubleBuffered=true;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;Size=new Size(390,174);BackColor=Theme.Surface;Padding=new Padding(16);Font=new Font("Segoe UI",10);icon.Image=appIcon.ToBitmap();icon.SizeMode=PictureBoxSizeMode.Zoom;icon.SetBounds(16,18,36,36);Controls.Add(icon);heading.SetBounds(64,14,280,46);heading.ForeColor=Theme.Text;heading.Font=new Font("Segoe UI Semibold",11);heading.AutoEllipsis=true;Controls.Add(heading);detail.SetBounds(64,62,300,96);detail.ForeColor=Theme.Text;detail.Font=Font;Controls.Add(detail);var close=new Button{Text="×",FlatStyle=FlatStyle.Flat,ForeColor=Theme.Text,BackColor=Theme.Surface,Size=new Size(28,28),Location=new Point(356,5),TabStop=false};close.FlatAppearance.BorderSize=0;close.Click+=delegate{Hide();timer.Stop();};Controls.Add(close);Click+=delegate{open();Hide();};heading.Click+=delegate{open();Hide();};detail.Click+=delegate{open();Hide();};icon.Click+=delegate{open();Hide();};timer.Tick+=delegate{Hide();timer.Stop();};AccessibleName="UniversalStream Assist desktop alert";}
 protected override bool ShowWithoutActivation{get{return true;}}
 protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80;return p;}}
 public void RefreshEmotes(Alert alert,EmoteCache cache){if(current!=alert)return;detail.Invalidate();}
 public void Present(Alert alert,string title,EmoteCache cache,Rectangle area){current=alert;if(icon.Image!=null)icon.Image.Dispose();icon.Image=new Bitmap(ActionIcons.Get(alert.Kind));heading.Text=(alert.Demo?"Sample · ":"")+alert.Name+"\n"+title+" · "+alert.Platform;detail.Alert=alert;detail.Cache=cache;detail.Invalidate();Location=new Point(area.Right-Width-16,area.Bottom-Height-16);Show();timer.Stop();timer.Start();}
 protected override void Dispose(bool disposing){if(disposing){timer.Dispose();if(icon.Image!=null)icon.Image.Dispose();}base.Dispose(disposing);}
}





